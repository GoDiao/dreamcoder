import { conversationService } from '../services/conversationService.js'
import { browserHostChannel, type BrowserHostChannel } from './hostChannel.js'
import { sessionStateStore, type SessionStateStore } from '../session/state/store.js'
import { bindGrantChannel, SessionBrowserGrants } from './grants.js'
import { BrowserService } from './service.js'
import { createSnapshotter } from './snapshot/index.js'
import { browserSessionTokens } from './sessionTokens.js'
import { BrowserTrustStore } from './trustStore.js'

export function bindPickChannel(channel: BrowserHostChannel, service: BrowserService) {
  channel.setPickHandler(({ tabId, generation, backendNodeId, expiresAt }) => service.pick(tabId, generation, backendNodeId, expiresAt))
  channel.setMarksHandler(({ tabId, generation, refs, expiresAt }) => service.marks(tabId, generation, refs, expiresAt))
  return () => {
    channel.setPickHandler(null)
    channel.setMarksHandler(null)
  }
}

export function bindBrowserActivity(service: BrowserService, store: Pick<SessionStateStore, 'apply' | 'applyIfPresent'>) {
  return service.onActivity((sessionId, tabId, active) => {
    if (active) store.apply(sessionId, { type: 'browser_activity_changed', activity: { tabId } })
    else store.applyIfPresent(sessionId, { type: 'browser_activity_changed', activity: null })
  })
}

export function bindEmulationReset(service: BrowserService, store: Pick<SessionStateStore, 'subscribe'>) {
  return store.subscribe((change) => {
    if (change.previous.turn.phase === 'idle' || change.state.turn.phase !== 'idle') return
    void service.resetEmulation(change.sessionId)
  })
}

let shared: { service: BrowserService; channel: BrowserHostChannel; tokens: typeof browserSessionTokens } | null = null

export function getBrowserRuntime() {
  if (shared) return shared
  const trust = new BrowserTrustStore()
  const grants = new SessionBrowserGrants({ store: sessionStateStore, trust })
  const service = new BrowserService({
    channel: browserHostChannel,
    grants,
    getProjectRoot: (sessionId) => conversationService.getSessionWorkDir(sessionId) || null,
    createSnapshotter,
  })
  const runtime = { service, channel: browserHostChannel, tokens: browserSessionTokens }
  bindGrantChannel(runtime.channel, grants, trust)
  bindPickChannel(runtime.channel, runtime.service)
  bindBrowserActivity(runtime.service, sessionStateStore)
  bindEmulationReset(runtime.service, sessionStateStore)
  conversationService.onProcessEvent((event) => {
    if (event.phase !== 'stopped' && event.phase !== 'failed') return
    runtime.tokens.revoke(event.sessionId)
    void runtime.service.releaseSession(event.sessionId)
  })
  shared = runtime
  return runtime
}
