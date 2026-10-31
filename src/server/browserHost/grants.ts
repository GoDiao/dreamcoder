import type { SessionStateStore } from '../session/state/store.js'
import type { BrowserHostChannel } from './hostChannel.js'
import type { BrowserGrantDecision } from './protocol.js'
import { BrowserToolError, type BrowserGrantRequest, type BrowserGrants } from './service.js'
import type { BrowserTrustStore } from './trustStore.js'

export const BROWSER_GRANT_TIMEOUT_MS = 60_000

const LOG_PREFIX = '[browser-grants]'

type Waiter = {
  resolve: () => void
  reject: (error: Error) => void
  detach: () => void
}

type PendingGrant = {
  requestId: string
  sessionId: string
  origin: string
  action: string
  onceOnly: boolean
  allowOnce: boolean
  allowSession: boolean
  timer: ReturnType<typeof setTimeout>
  waiters: Set<Waiter>
}

export type BrowserGrantsDeps = {
  store: SessionStateStore
  trust: { has(origin: string): Promise<boolean> }
  timeoutMs?: number
  now?: () => number
}

function cancelledError(message: string) {
  return new BrowserToolError('cancelled', `[browser.cancelled] ${message}`)
}

function notGrantedError(message: string) {
  return new BrowserToolError('not_granted', `[browser.not_granted] ${message}`)
}

export class SessionBrowserGrants implements BrowserGrants {
  private readonly store: SessionStateStore
  private readonly trust: BrowserGrantsDeps['trust']
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly sessionTrusted = new Map<string, Set<string>>()
  private readonly pending = new Map<string, PendingGrant>()

  constructor(deps: BrowserGrantsDeps) {
    this.store = deps.store
    this.trust = deps.trust
    this.timeoutMs = deps.timeoutMs ?? BROWSER_GRANT_TIMEOUT_MS
    this.now = deps.now ?? Date.now
  }

  async ensureOperation(request: BrowserGrantRequest, signal: AbortSignal | undefined): Promise<void> {
    this.assertNotAborted(signal)
    if (this.isSessionTrusted(request.sessionId, request.origin)) return
    if (await this.trust.has(request.origin)) return
    this.assertNotAborted(signal)
    if (this.isSessionTrusted(request.sessionId, request.origin)) return
    const grant = this.findPending(request) ?? this.open(request)
    await this.wait(grant, signal)
  }

  reply(requestId: string, decision: BrowserGrantDecision): boolean {
    const grant = this.pending.get(requestId)
    if (!grant) return false
    if (decision === 'once' && !grant.allowOnce) {
      console.warn(`${LOG_PREFIX} ignoring a one-time approval for ${grant.origin}: this session only offers trusting the site`)
      return false
    }
    if (decision === 'session' && !grant.allowSession) {
      console.warn(`${LOG_PREFIX} ignoring a session approval for ${grant.origin}: this request only offers allowing the action once`)
      return false
    }
    if (decision === 'deny') {
      this.settle(grant, notGrantedError(`The user did not allow operating ${grant.origin}. Do not repeat the action; ask the user how to proceed.`))
      return true
    }
    if (decision === 'session') this.trustForSession(grant.sessionId, grant.origin)
    this.settle(grant, null)
    return true
  }

  cancelSession(sessionId: string): void {
    for (const grant of [...this.pending.values()]) {
      if (grant.sessionId === sessionId) {
        this.settle(grant, cancelledError('Browser control for this session ended while waiting for permission, so the action was not run.'))
      }
    }
  }

  endSession(sessionId: string): void {
    this.cancelSession(sessionId)
    this.sessionTrusted.delete(sessionId)
  }

  private assertNotAborted(signal: AbortSignal | undefined) {
    if (signal?.aborted) throw cancelledError('The browser call was cancelled before permission was asked, so the action was not run.')
  }

  private isSessionTrusted(sessionId: string, origin: string) {
    return this.sessionTrusted.get(sessionId)?.has(origin) ?? false
  }

  private trustForSession(sessionId: string, origin: string) {
    const origins = this.sessionTrusted.get(sessionId) ?? new Set<string>()
    origins.add(origin)
    this.sessionTrusted.set(sessionId, origins)
  }

  private findPending(request: BrowserGrantRequest) {
    const onceOnly = request.onceOnly === true
    for (const grant of this.pending.values()) {
      if (
        grant.sessionId === request.sessionId &&
        grant.origin === request.origin &&
        grant.action === request.action &&
        grant.onceOnly === onceOnly
      ) {
        return grant
      }
    }
    return undefined
  }

  private isBypass(sessionId: string) {
    const permission = this.store.peek(sessionId)?.permission
    return (permission?.effective ?? permission?.desired) === 'bypassPermissions'
  }

  private open(request: BrowserGrantRequest): PendingGrant {
    const requestId = crypto.randomUUID()
    const onceOnly = request.onceOnly === true
    const grant: PendingGrant = {
      requestId,
      sessionId: request.sessionId,
      origin: request.origin,
      action: request.action,
      onceOnly,
      allowOnce: onceOnly || !this.isBypass(request.sessionId),
      allowSession: !onceOnly,
      timer: setTimeout(() => this.expire(requestId), this.timeoutMs),
      waiters: new Set(),
    }
    this.pending.set(requestId, grant)
    this.store.apply(request.sessionId, {
      type: 'browser_grant_requested',
      grant: {
        requestId,
        origin: request.origin,
        action: request.action,
        requestedAt: this.now(),
        allowOnce: grant.allowOnce,
        allowSession: grant.allowSession,
      },
    })
    return grant
  }

  private wait(grant: PendingGrant, signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        grant.waiters.delete(waiter)
        reject(cancelledError('The browser call was cancelled while waiting for permission, so the action was not run.'))
        if (grant.waiters.size === 0) this.close(grant)
      }
      const waiter: Waiter = {
        resolve,
        reject,
        detach: () => signal?.removeEventListener('abort', onAbort),
      }
      grant.waiters.add(waiter)
      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private expire(requestId: string) {
    const grant = this.pending.get(requestId)
    if (!grant) return
    const seconds = Math.round(this.timeoutMs / 1000)
    this.settle(
      grant,
      notGrantedError(
        `No client answered the permission request for ${grant.origin} within ${seconds} seconds, so the action was not run. Ask the user to answer the prompt, then try again.`,
      ),
    )
  }

  private settle(grant: PendingGrant, failure: Error | null) {
    this.close(grant)
    for (const waiter of grant.waiters) {
      waiter.detach()
      if (failure) waiter.reject(failure)
      else waiter.resolve()
    }
    grant.waiters.clear()
  }

  private close(grant: PendingGrant) {
    clearTimeout(grant.timer)
    if (this.pending.delete(grant.requestId)) {
      this.store.applyIfPresent(grant.sessionId, { type: 'browser_grant_closed', requestId: grant.requestId })
    }
  }
}

export function bindGrantChannel(channel: BrowserHostChannel, grants: SessionBrowserGrants, trust: BrowserTrustStore) {
  const unsubscribe = channel.onGrantReply(({ requestId, decision }) => {
    grants.reply(requestId, decision)
  })
  channel.setTrustHandler((request) => trust.handle(request))
  return () => {
    unsubscribe()
    channel.setTrustHandler(null)
  }
}
