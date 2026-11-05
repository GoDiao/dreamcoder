import * as fs from 'node:fs/promises'
import {
  SDKControlSessionListRequestSchema,
  SDKControlSessionRenameRequestSchema,
  SDKControlSessionSendRequestSchema,
  SDKControlSessionStartRequestSchema,
  type SDKControlSessionListResponse,
  type SDKControlSessionRenameResponse,
  type SDKControlSessionSendResponse,
  type SDKControlSessionStartRequest,
  type SDKControlSessionStartResponse,
} from '../../entrypoints/sdk/controlSchemas.js'
import type { SessionOrigin } from '../../entrypoints/sdk/coreSchemas.js'
import { buildSessionOrigin, sanitizeDisplayName } from '../../utils/crossSessionEnvelope.js'
import { createSessionBranch, SessionBranchingError } from '../../utils/sessionBranching.js'
import { SESSION_ID_PATTERN } from '../sessionId.js'
import { sessionStateStore } from '../session/state/store.js'
import { conversationService } from './conversationService.js'
import { removeAgentWorktree } from '../../utils/worktree.js'
import { prepareSessionWorkspace } from './repositoryLaunchService.js'
import { sessionService, type SessionRelation } from './sessionService.js'

const MAX_LISTED_SESSIONS = 500
const FORKED_SESSION_NOTE =
  'This call started a new session forked from this conversation, and you are in that session now. The turn above belongs to the parent session, which carries on with it. Do only what the next message asks.'

export type SessionRenamed = (sessionId: string, title: string) => void

export type UserTurnDelivery = (
  sessionId: string,
  content: string,
  origin: SessionOrigin,
) => Promise<{ ok: boolean; message?: string }>

type CliControlRequest = {
  request_id?: unknown
  request?: { subtype?: unknown }
}

const SESSION_REQUEST_SUBTYPES = new Set(['session_start', 'session_send', 'session_list', 'session_rename'])

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createSessionLinks(deliver: UserTurnDelivery, onRenamed: SessionRenamed) {
  const store = sessionStateStore

  async function describe(sessionId: string): Promise<(SessionRelation & { title: string }) | null> {
    return sessionService.getSessionLinkInfo(sessionId)
  }

  function originFor(
    sessionId: string,
    info: SessionRelation & { title: string },
    purpose: SessionOrigin['purpose'],
    summary?: string,
  ): SessionOrigin {
    return buildSessionOrigin(sessionId, info.title, purpose, summary)
  }

  async function removeWorktree(
    repository: { repoRoot?: string; worktreePath?: string; worktreeBranch?: string } | undefined,
  ): Promise<void> {
    if (!repository?.worktreePath || !repository.repoRoot) return
    if (!(await fs.stat(repository.worktreePath).then(() => true, () => false))) return
    const removed = await removeAgentWorktree(repository.worktreePath, repository.worktreeBranch, repository.repoRoot).catch(
      () => false,
    )
    if (!removed) console.warn(`[SessionLinks] Could not remove the worktree ${repository.worktreePath} of a failed start`)
  }

  async function discard(sessionId: string): Promise<void> {
    const repository = (await sessionService.getSessionLaunchInfo(sessionId))?.repository
    conversationService.markSessionDeleted(sessionId)
    try {
      await sessionService.deleteSession(sessionId)
    } catch (error) {
      conversationService.unmarkSessionDeleted(sessionId)
      console.warn(`[SessionLinks] Could not remove session ${sessionId} after a failed start: ${errorMessage(error)}`)
      return
    }
    if (repository?.worktree) await removeWorktree(repository)
  }

  async function createChild(
    callerId: string,
    request: SDKControlSessionStartRequest,
    title: string,
  ): Promise<string> {
    const launch = await sessionService.getSessionLaunchInfo(callerId)
    if (!launch) throw new Error(`Session not found: ${callerId}`)
    const caller = await store.read(callerId)
    const parent = { sessionId: callerId, kind: 'spawned' as const }

    const workDir = conversationService.getSessionWorkDir(callerId) || launch.workDir

    if (request.context === 'fork') {
      const sessionId = crypto.randomUUID()
      const workspace = request.worktree
        ? await prepareSessionWorkspace(workDir, { worktree: true }, sessionId)
        : undefined
      try {
        const branch = await createSessionBranch({
          sessionId,
          sourceSessionId: callerId,
          sourceTranscriptPath: launch.filePath,
          title,
          sourceWorkDir: launch.workDir,
          sourceRepository: launch.repository,
          sourceWorktreeSession: launch.worktreeSession,
          parentKind: parent.kind,
          openToolUseResult: FORKED_SESSION_NOTE,
          ...(workspace ? { workspace: { workDir: workspace.workDir, repository: workspace.repository } } : {}),
        })
        await sessionService.appendSessionPermissionMode(branch.sessionId, caller.permission.desired)
        if (caller.runtime.desired) await sessionService.appendSessionRuntimeConfig(branch.sessionId, caller.runtime.desired)
        return branch.sessionId
      } catch (error) {
        await removeWorktree(workspace?.repository)
        if (error instanceof SessionBranchingError) throw new Error(error.message)
        throw error
      }
    }

    const created = await sessionService.createSession(
      workDir,
      request.worktree ? { worktree: true } : undefined,
      caller.permission.desired,
      caller.runtime.desired ?? undefined,
      { parent },
    )
    return created.sessionId
  }

  async function startSession(callerId: string, request: SDKControlSessionStartRequest): Promise<SDKControlSessionStartResponse> {
    const callerInfo = await describe(callerId)
    if (!callerInfo) throw new Error(`Session not found: ${callerId}`)
    const title = request.title.trim()
    if (!title) throw new Error('A session needs a title')

    const childId = await createChild(callerId, request, title)
    try {
      await sessionService.renameSession(childId, title)
      const delivery = await deliver(childId, request.prompt, originFor(callerId, callerInfo, 'brief', title))
      if (!delivery.ok) throw new Error(delivery.message ?? 'The session could not be started')
    } catch (error) {
      await discard(childId)
      throw error
    }
    return { sessionId: childId, title }
  }

  async function queueReport(
    callerId: string,
    callerInfo: SessionRelation & { title: string },
    to: string,
    message: string,
    summary: string,
  ): Promise<void> {
    const report = {
      id: crypto.randomUUID(),
      from: { sessionId: callerId, name: callerInfo.title },
      summary,
      createdAt: Date.now(),
    }
    await store.ensure(to)
    await sessionService.appendSessionReport(to, { ...report, message })
    store.apply(to, { type: 'report_queued', report })
  }

  async function sendToSession(
    callerId: string,
    to: string,
    message: string,
    summary: string,
    mode: 'message' | 'report' = 'message',
  ): Promise<SDKControlSessionSendResponse> {
    if (!SESSION_ID_PATTERN.test(to)) return { delivered: false, error: `Not a session id: ${to}` }
    if (to === callerId) return { delivered: false, error: 'A session cannot message itself.' }
    const target = await describe(to)
    if (!target) return { delivered: false, error: `Session not found: ${to}` }
    const callerInfo = await describe(callerId)
    if (!callerInfo) return { delivered: false, error: `Session not found: ${callerId}` }

    if (mode === 'report') {
      if (callerInfo.parent?.sessionId !== to) {
        return { delivered: false, error: 'A report can only be sent to your parent session.' }
      }
      const parentTurnRunning = (store.peek(to)?.turn.phase ?? 'idle') !== 'idle'
      if (!parentTurnRunning) {
        await queueReport(callerId, callerInfo, to, message, summary)
        return { delivered: true }
      }
    }

    const delivery = await deliver(to, message, originFor(callerId, callerInfo, mode, summary)).catch(
      (error: unknown) => ({ ok: false, message: errorMessage(error) }),
    )
    return delivery.ok ? { delivered: true } : { delivered: false, error: delivery.message ?? 'The message could not be delivered' }
  }

  async function listSessions(callerId: string, project?: string): Promise<SDKControlSessionListResponse> {
    const [{ sessions }, callerInfo] = await Promise.all([
      sessionService.listSessions({ project, limit: MAX_LISTED_SESSIONS }),
      describe(callerId),
    ])
    return {
      sessions: sessions.map((session) => {
        const relation =
          session.id === callerId
            ? 'self'
            : session.parent?.sessionId === callerId
              ? 'child'
              : callerInfo?.parent?.sessionId === session.id
                ? 'parent'
                : 'none'
        const turnPhase = store.peek(session.id)?.turn.phase
        return {
          sessionId: session.id,
          title: session.title,
          project: session.workDir ?? session.projectPath,
          ...(session.parent ? { parentSessionId: session.parent.sessionId } : {}),
          relation,
          running: conversationService.hasSession(session.id) && turnPhase !== undefined && turnPhase !== 'idle',
        } as const
      }),
    }
  }

  async function renameSession(callerId: string, rawTitle: string): Promise<SDKControlSessionRenameResponse> {
    const title = sanitizeDisplayName(rawTitle)
    if (!title) throw new Error('A session title cannot be empty')
    await sessionService.renameSession(callerId, title)
    onRenamed(callerId, title)
    return { title }
  }

  async function answer(callerId: string, requestId: string, work: () => Promise<Record<string, unknown>>): Promise<void> {
    let reply: { response: Record<string, unknown> } | { error: string }
    try {
      reply = { response: await work() }
    } catch (error) {
      reply = { error: errorMessage(error) }
    }
    conversationService.respondToHostRequest(callerId, requestId, reply)
  }

  return {
    handleControlRequest(callerId: string, cliMsg: CliControlRequest): boolean {
      const subtype = cliMsg.request?.subtype
      if (typeof subtype !== 'string' || !SESSION_REQUEST_SUBTYPES.has(subtype)) return false
      const requestId = cliMsg.request_id
      if (typeof requestId !== 'string') return true

      void answer(callerId, requestId, async () => {
        if (subtype === 'session_start') {
          const parsed = SDKControlSessionStartRequestSchema().safeParse(cliMsg.request)
          if (!parsed.success) throw new Error('Invalid session_start request')
          return startSession(callerId, parsed.data)
        }
        if (subtype === 'session_send') {
          const parsed = SDKControlSessionSendRequestSchema().safeParse(cliMsg.request)
          if (!parsed.success) throw new Error('Invalid session_send request')
          return sendToSession(callerId, parsed.data.to, parsed.data.message, parsed.data.summary, parsed.data.mode)
        }
        if (subtype === 'session_rename') {
          const parsed = SDKControlSessionRenameRequestSchema().safeParse(cliMsg.request)
          if (!parsed.success) throw new Error('Invalid session_rename request')
          return renameSession(callerId, parsed.data.title)
        }
        const parsed = SDKControlSessionListRequestSchema().safeParse(cliMsg.request)
        if (!parsed.success) throw new Error('Invalid session_list request')
        return listSessions(callerId, parsed.data.project)
      })
      return true
    },
  }
}
