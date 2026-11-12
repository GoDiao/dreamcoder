import * as fs from 'node:fs/promises'
import {
  SDKControlSessionListRequestSchema,
  SDKControlSessionRenameRequestSchema,
  SDKControlSessionSendRequestSchema,
  SDKControlSessionStartRequestSchema,
  type KANBAN_ROLES,
  type SDKControlSessionListResponse,
  type SDKControlSessionRenameResponse,
  type SDKControlSessionSendResponse,
  type SDKControlSessionStartRequest,
  type SDKControlSessionStartResponse,
} from '../../entrypoints/sdk/controlSchemas.js'
import type { UserMessageOrigin } from '../../entrypoints/sdk/coreSchemas.js'
import { buildSessionOrigin, sanitizeDisplayName } from '../../utils/crossSessionEnvelope.js'
import { errorMessage } from '../../utils/errors.js'
import { createSessionBranch, SessionBranchingError, type SessionParent } from '../../utils/sessionBranching.js'
import { SESSION_ID_PATTERN } from '../sessionId.js'
import { sessionStateStore } from '../session/state/store.js'
import { conversationService, type HostRequest } from './conversationService.js'
import { removeAgentWorktree } from '../../utils/worktree.js'
import { prepareSessionWorkspace, type CreateSessionRepositoryOptions } from './repositoryLaunchService.js'
import { sessionService } from './sessionService.js'
import type { QueuedReport } from './turnQueueService.js'

const MAX_LISTED_SESSIONS = 500
const FORKED_SESSION_NOTE =
  'This call started a new session forked from this conversation, and you are in that session now. The turn above belongs to the parent session, which carries on with it. Do only what the next message asks.'

export type SessionRenamed = (sessionId: string, title: string) => void

export type UserTurnDelivery = (
  sessionId: string,
  content: string,
  origin: UserMessageOrigin,
) => Promise<{ ok: boolean; message?: string }>

const SESSION_REQUEST_SUBTYPES = new Set(['session_start', 'session_send', 'session_list', 'session_rename'])

export type CardAssigneeStart = { card: number; role: (typeof KANBAN_ROLES)[number]; instructions: string }

export type StartedSession = { sessionId: string; message: string; abandon: (reason: string) => Promise<void> }

export type CardAssigneeLaunch = (
  callerId: string,
  start: CardAssigneeStart,
  launch: () => Promise<string>,
) => Promise<StartedSession>

export type SessionLinksDeps = {
  deliver: UserTurnDelivery
  queueReport: (to: string, report: QueuedReport) => Promise<void>
  onRenamed: SessionRenamed
  startCardAssignee: CardAssigneeLaunch
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

export async function discardSession(sessionId: string): Promise<void> {
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

export type LinkedSessionOptions = {
  workDir: string
  repository?: CreateSessionRepositoryOptions
  parent?: SessionParent
  title: string
}

export async function createLinkedSession({ workDir, repository, parent, title }: LinkedSessionOptions): Promise<string> {
  const parentState = parent ? await sessionStateStore.read(parent.sessionId) : undefined
  const { sessionId } = await sessionService.createSession(
    workDir,
    repository,
    parentState?.permission.desired,
    parentState?.runtime.desired ?? undefined,
    parent ? { parent } : undefined,
  )
  try {
    await sessionService.renameSession(sessionId, title)
  } catch (error) {
    await discardSession(sessionId)
    throw error
  }
  return sessionId
}

export function isSessionRunning(sessionId: string): boolean {
  const phase = sessionStateStore.peek(sessionId)?.turn.phase
  return conversationService.hasSession(sessionId) && phase !== undefined && phase !== 'idle'
}

export function createSessionLinks({ deliver, queueReport, onRenamed, startCardAssignee }: SessionLinksDeps) {
  const store = sessionStateStore

  async function createChild(
    callerId: string,
    request: SDKControlSessionStartRequest,
    title: string,
  ): Promise<string> {
    const launch = await sessionService.getSessionLaunchInfo(callerId)
    if (!launch) throw new Error(`Session not found: ${callerId}`)
    const workDir = conversationService.getSessionWorkDir(callerId) || launch.workDir

    if (request.context !== 'fork') {
      return createLinkedSession({
        workDir,
        repository: request.worktree ? { worktree: true } : undefined,
        parent: { sessionId: callerId, kind: 'spawned' },
        title,
      })
    }

    const caller = await store.read(callerId)
    const sessionId = crypto.randomUUID()
    const workspace = request.worktree
      ? await prepareSessionWorkspace(workDir, { worktree: true }, sessionId)
      : undefined
    let branchId: string
    try {
      const branch = await createSessionBranch({
        sessionId,
        sourceSessionId: callerId,
        sourceTranscriptPath: launch.filePath,
        title,
        sourceWorkDir: launch.workDir,
        sourceRepository: launch.repository,
        sourceWorktreeSession: launch.worktreeSession,
        parentKind: 'spawned',
        openToolUseResult: FORKED_SESSION_NOTE,
        ...(workspace ? { workspace: { workDir: workspace.workDir, repository: workspace.repository } } : {}),
      })
      branchId = branch.sessionId
    } catch (error) {
      await removeWorktree(workspace?.repository)
      if (error instanceof SessionBranchingError) throw new Error(error.message)
      throw error
    }
    try {
      await sessionService.appendSessionPermissionMode(branchId, caller.permission.desired)
      if (caller.runtime.desired) await sessionService.appendSessionRuntimeConfig(branchId, caller.runtime.desired)
      await sessionService.renameSession(branchId, title)
    } catch (error) {
      await discardSession(branchId)
      throw error
    }
    return branchId
  }

  async function startSession(callerId: string, request: SDKControlSessionStartRequest): Promise<SDKControlSessionStartResponse> {
    const callerInfo = await sessionService.getSessionLinkInfo(callerId)
    if (!callerInfo) throw new Error(`Session not found: ${callerId}`)
    const title = request.title.trim()
    if (!title) throw new Error('A session needs a title')

    const launch = () => createChild(callerId, request, title)
    const started: StartedSession =
      request.card === undefined
        ? await launch().then((sessionId) => ({ sessionId, message: request.prompt, abandon: () => discardSession(sessionId) }))
        : await startCardAssignee(callerId, { card: request.card, role: request.role ?? 'owner', instructions: request.prompt }, launch)
    try {
      const delivery = await deliver(started.sessionId, started.message, buildSessionOrigin(callerId, callerInfo.title, 'brief', title))
      if (!delivery.ok) throw new Error(delivery.message ?? 'The session could not be started')
    } catch (error) {
      await started.abandon(errorMessage(error))
      throw error
    }
    return { sessionId: started.sessionId, title }
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
    const target = await sessionService.getSessionLinkInfo(to)
    if (!target) return { delivered: false, error: `Session not found: ${to}` }
    const callerInfo = await sessionService.getSessionLinkInfo(callerId)
    if (!callerInfo) return { delivered: false, error: `Session not found: ${callerId}` }

    if (mode === 'report') {
      if (callerInfo.parent?.sessionId !== to) {
        return { delivered: false, error: 'A report can only be sent to your parent session.' }
      }
      const parentTurnRunning = (store.peek(to)?.turn.phase ?? 'idle') !== 'idle'
      if (!parentTurnRunning) {
        await queueReport(to, { from: { sessionId: callerId, name: callerInfo.title }, message, summary })
        return { delivered: true }
      }
    }

    const delivery = await deliver(to, message, buildSessionOrigin(callerId, callerInfo.title, mode, summary)).catch(
      (error: unknown) => ({ ok: false, message: errorMessage(error) }),
    )
    return delivery.ok ? { delivered: true } : { delivered: false, error: delivery.message ?? 'The message could not be delivered' }
  }

  async function listSessions(callerId: string, project?: string): Promise<SDKControlSessionListResponse> {
    const [{ sessions }, callerInfo] = await Promise.all([
      sessionService.listSessions({ project, limit: MAX_LISTED_SESSIONS }),
      sessionService.getSessionLinkInfo(callerId),
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
        return {
          sessionId: session.id,
          title: session.title,
          project: session.workDir ?? session.projectPath,
          ...(session.parent ? { parentSessionId: session.parent.sessionId } : {}),
          relation,
          running: isSessionRunning(session.id),
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

  return {
    handleControlRequest(callerId: string, cliMsg: HostRequest): boolean {
      return conversationService.answerHostRequest(callerId, cliMsg, SESSION_REQUEST_SUBTYPES, async (subtype) => {
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
    },
  }
}
