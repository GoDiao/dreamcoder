import type { SessionReport, UserMessageOrigin } from '../../entrypoints/sdk/coreSchemas.js'
import { buildSessionOrigin } from '../../utils/crossSessionEnvelope.js'
import { errorMessage } from '../../utils/errors.js'
import { sessionStateStore } from '../session/state/store.js'
import type { AttachmentRef, ServerMessage } from '../ws/protocol.js'
import { getSessionRuntime, peekSessionRuntime } from '../ws/sessionRuntime.js'
import { conversationService } from './conversationService.js'
import { sessionService } from './sessionService.js'

export type SessionBroadcast = (sessionId: string, message: ServerMessage) => void

export type QueuedTurnDelivery = (
  sessionId: string,
  content: string,
  options: { attachments?: AttachmentRef[]; id: string },
) => Promise<unknown>

export type QueuedReport = {
  from: { sessionId: string; name: string }
  message: string
  summary: string
}

export function createTurnQueue(broadcast: SessionBroadcast, deliver: QueuedTurnDelivery) {
  const store = sessionStateStore

  function shouldQueue(sessionId: string, content: string, origin: UserMessageOrigin | undefined): boolean {
    const state = store.peek(sessionId)
    return !origin &&
      !content.trimStart().startsWith('/') &&
      (state?.turn.phase !== 'idle' || (state?.queuedMessages.length ?? 0) > 0)
  }

  function rememberPayload(sessionId: string, id: string, content: string, attachments?: AttachmentRef[]): void {
    const payloads = getSessionRuntime(sessionId).queuedPayloads
    const queued = new Set(store.peek(sessionId)?.queuedMessages.map((message) => message.id))
    for (const key of payloads.keys()) {
      if (!queued.has(key)) payloads.delete(key)
    }
    payloads.set(id, { content, attachments })
  }

  function queueMessage(sessionId: string, id: string, content: string, attachments?: AttachmentRef[]): boolean {
    rememberPayload(sessionId, id, content, attachments)
    const held = !!store.peek(sessionId)?.process.pendingRestart
    const sent = held ||
      conversationService.sendMessage(sessionId, content, attachments, id, undefined, undefined, 'later')
    if (!sent) return false
    store.apply(sessionId, {
      type: 'message_queued',
      message: { id, content, attachmentCount: attachments?.length ?? 0, createdAt: Date.now() },
    })
    return true
  }

  async function cancelMessage(sessionId: string, id: string): Promise<void> {
    if (!store.peek(sessionId)?.queuedMessages.some((queued) => queued.id === id)) return
    try {
      if (await conversationService.cancelQueuedMessage(sessionId, id)) {
        store.apply(sessionId, { type: 'queued_message_cancelled', id })
      }
    } catch (error) {
      console.warn(`[TurnQueue] Could not cancel queued message ${id} of ${sessionId}: ${errorMessage(error)}`)
    }
  }

  function interrupt(sessionId: string): boolean {
    const state = store.peek(sessionId)
    if (!state?.queuedMessages.length) return false
    const pipeline = peekSessionRuntime(sessionId)?.pipeline
    if (state.turn.phase !== 'idle' && pipeline) pipeline.stream.stopRequested = true
    conversationService.sendInterrupt(sessionId)
    return true
  }

  function heldMessageIds(sessionId: string): string[] {
    return store.peek(sessionId)?.queuedMessages.map((message) => message.id) ?? []
  }

  async function withdrawFromCli(sessionId: string): Promise<void> {
    for (const id of heldMessageIds(sessionId)) {
      await conversationService.cancelQueuedMessage(sessionId, id).catch((error: unknown) => {
        console.warn(`[TurnQueue] Could not hold queued message ${id} of ${sessionId} for a restart: ${errorMessage(error)}`)
      })
    }
  }

  async function redeliver(sessionId: string, ids: string[]): Promise<void> {
    const payloads = peekSessionRuntime(sessionId)?.queuedPayloads
    for (const id of ids) {
      store.apply(sessionId, { type: 'queued_message_cancelled', id })
    }
    for (const id of ids) {
      const payload = payloads?.get(id)
      payloads?.delete(id)
      if (payload) await deliver(sessionId, payload.content, { attachments: payload.attachments, id })
    }
  }

  async function queueReport(to: string, { from, message, summary }: QueuedReport): Promise<void> {
    const report = { id: crypto.randomUUID(), from, summary, createdAt: Date.now() }
    await store.ensure(to)
    await sessionService.appendSessionReport(to, { ...report, message })
    store.apply(to, { type: 'report_queued', report })
  }

  async function claimReports(sessionId: string): Promise<SessionReport[]> {
    const state = await store.ensure(sessionId)
    if (state.pendingReports.length === 0) return []
    const stored = await sessionService.getPendingReports(sessionId)
    const queued = new Set(store.peek(sessionId)?.pendingReports.map((report) => report.id))
    return stored
      .filter((entry) => queued.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        message: entry.message,
        origin: buildSessionOrigin(entry.from.sessionId, entry.from.name, 'report', entry.summary),
      }))
  }

  async function markReportsDelivered(sessionId: string, reports: SessionReport[]): Promise<void> {
    if (reports.length === 0) return
    const ids = reports.map((report) => report.id)
    store.apply(sessionId, { type: 'reports_delivered', ids })
    for (const report of reports) {
      broadcast(sessionId, { type: 'user_message', id: report.id, content: report.message, origin: report.origin })
    }
    await sessionService.appendSessionReportsDelivered(sessionId, ids).catch((error: unknown) => {
      console.warn(`[TurnQueue] Could not record the delivered reports of ${sessionId}: ${errorMessage(error)}`)
    })
  }

  return {
    shouldQueue,
    queueMessage,
    cancelMessage,
    interrupt,
    heldMessageIds,
    withdrawFromCli,
    redeliver,
    queueReport,
    claimReports,
    markReportsDelivered,
  }
}
