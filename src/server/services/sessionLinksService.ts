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
import { createSessionBranch, SessionBranchingError, type BranchNote, type SessionParent } from '../../utils/sessionBranching.js'
import { ApiError } from '../middleware/errorHandler.js'
import { SESSION_ID_PATTERN } from '../sessionId.js'
import { sessionStateStore } from '../session/state/store.js'
import { disposeSessionRuntime } from '../ws/sessionRuntime.js'
import { conversationService, type HostRequest } from './conversationService.js'
import { removeAgentWorktree } from '../../utils/worktree.js'
import { prepareSessionWorkspace, type CreateSessionRepositoryOptions } from './repositoryLaunchService.js'
import { sessionService, type DeleteSessionFailure, type DeleteSessionsResult } from './sessionService.js'
import { deriveTitle } from './titleService.js'
import type { QueuedReport } from './turnQueueService.js'

const MAX_LISTED_SESSIONS = 500
const FORKED_SESSION_NOTE =
  'This call started a new session forked from this conversation, and you are in that session now. The turn above belongs to the parent session, which carries on with it. Do only what the next message asks.'
export const SIDE_CHAT_NOTE: BranchNote = {
  always: true,
  text: 'This is a side chat forked from the conversation above. The parent session carries on with the turn above; do only what the next message asks.',
}
export const SIDE_CHAT_TITLE = 'btw'

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

export function closeSessionConnection(sessionId: string, reason = 'session closed'): boolean {
  const clients = disposeSessionRuntime(sessionId)?.clients
  sessionStateStore.dispose(sessionId)
  conversationService.forgetSession(sessionId)
  if (!clients || clients.size === 0) return false

  for (const ws of clients) {
    ws.close(1000, reason)
  }
  return true
}

export type RemovedSessions = DeleteSessionsResult & { sideChatFailures: DeleteSessionFailure[] }

export async function removeSessions(sessionIds: string[]): Promise<RemovedSessions> {
  const requested = new Set(sessionIds)
  const ids = [...new Set([...sessionIds, ...await sessionService.findSideChatIds(sessionIds)])]
  conversationService.blockStarts(ids, 'deleted')
  await Promise.all(ids.map((sessionId) => conversationService.stopSessionAndWait(sessionId)))
  const result = await sessionService.deleteSessions(ids)
  conversationService.unblockStarts(result.failures.map((failure) => failure.sessionId))
  for (const failure of result.failures) {
    const role = requested.has(failure.sessionId) ? 'session' : 'side chat'
    console.warn(`[SessionLinks] Could not remove ${role} ${failure.sessionId} while removing ${sessionIds.join(', ')}: ${failure.message}`)
  }
  for (const sessionId of result.successes) {
    closeSessionConnection(sessionId, 'session deleted')
  }
  return {
    successes: result.successes,
    failures: result.failures.filter((failure) => requested.has(failure.sessionId)),
    sideChatFailures: result.failures.filter((failure) => !requested.has(failure.sessionId)),
  }
}

export async function discardSession(sessionId: string): Promise<void> {
  const repository = (await sessionService.getSessionLaunchInfo(sessionId))?.repository
  const { failures } = await removeSessions([sessionId])
  if (failures.length > 0) return
  if (repository?.worktree && repository.worktreeOwnerSessionId === sessionId) await removeWorktree(repository)
}

export type ForkSessionOptions = {
  sourceId: string
  targetMessageId?: string
  parentKind: SessionParent['kind']
  title?: string
  exactTitle?: boolean
  note?: BranchNote
  worktree?: boolean
}

export type ForkedSession = { sessionId: string; title: string; workDir: string }

export async function forkSession({
  sourceId,
  targetMessageId,
  parentKind,
  title,
  exactTitle,
  note,
  worktree,
}: ForkSessionOptions): Promise<ForkedSession> {
  const launch = await sessionService.getSessionLaunchInfo(sourceId)
  if (!launch) throw new SessionBranchingError('SOURCE_NOT_FOUND', `Session not found: ${sourceId}`)
  const source = await sessionStateStore.read(sourceId)
  const sessionId = crypto.randomUUID()
  const workspace = worktree
    ? await prepareSessionWorkspace(conversationService.getSessionWorkDir(sourceId) || launch.workDir, { worktree: true }, sessionId)
    : undefined
  let branch: Awaited<ReturnType<typeof createSessionBranch>>
  try {
    branch = await createSessionBranch({
      sessionId,
      sourceSessionId: sourceId,
      sourceTranscriptPath: launch.filePath,
      targetMessageId,
      title,
      exactTitle,
      sourceWorkDir: launch.workDir,
      sourceRepository: launch.repository,
      sourceWorktreeSession: launch.worktreeSession,
      parentKind,
      note,
      ...(workspace ? { workspace: { workDir: workspace.workDir, repository: workspace.repository } } : {}),
    })
  } catch (error) {
    await removeWorktree(workspace?.repository)
    throw error
  }
  try {
    await sessionService.appendSessionPermissionMode(branch.sessionId, source.permission.desired)
    if (source.runtime.desired) await sessionService.appendSessionRuntimeConfig(branch.sessionId, source.runtime.desired)
  } catch (error) {
    await discardSession(branch.sessionId)
    throw error
  }
  return { sessionId: branch.sessionId, title: branch.title, workDir: branch.workDir ?? launch.workDir }
}

export async function detachSideChat(sessionId: string): Promise<void> {
  const info = await sessionService.getSessionLinkInfo(sessionId)
  if (!info) throw ApiError.notFound(`Session not found: ${sessionId}`)
  if (info.parent?.kind !== 'side') throw ApiError.badRequest('Only a side chat can be detached')
  if (isSessionRunning(sessionId)) throw ApiError.conflict('A side chat cannot be detached while it is running')
  conversationService.blockStarts([sessionId], 'detaching')
  try {
    await conversationService.stopSessionAndWait(sessionId)
    await sessionService.setSessionParent(sessionId, { sessionId: info.parent.sessionId, kind: 'forked' })
  } finally {
    conversationService.unblockStarts([sessionId])
  }
}

export async function titleSideChat(sessionId: string, input: string): Promise<string | null> {
  if ((await sessionStateStore.ensure(sessionId)).title.text !== SIDE_CHAT_TITLE) return null
  if ((await sessionService.getSessionLinkInfo(sessionId))?.parent?.kind !== 'side') return null
  const derived = deriveTitle(input)
  if (!derived) return null
  const title = `${SIDE_CHAT_TITLE}: ${derived}`
  await sessionService.renameSession(sessionId, title)
  return title
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
    if (request.context === 'fork') {
      try {
        const forked = await forkSession({
          sourceId: callerId,
          parentKind: 'spawned',
          title,
          exactTitle: true,
          note: { text: FORKED_SESSION_NOTE, always: false },
          worktree: request.worktree,
        })
        return forked.sessionId
      } catch (error) {
        if (error instanceof SessionBranchingError) throw new Error(error.message)
        throw error
      }
    }

    const launch = await sessionService.getSessionLaunchInfo(callerId)
    if (!launch) throw new Error(`Session not found: ${callerId}`)
    return createLinkedSession({
      workDir: conversationService.getSessionWorkDir(callerId) || launch.workDir,
      repository: request.worktree ? { worktree: true } : undefined,
      parent: { sessionId: callerId, kind: 'spawned' },
      title,
    })
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
      sessionService.listSessions({ project, limit: MAX_LISTED_SESSIONS, sideChatsOf: callerId }),
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
