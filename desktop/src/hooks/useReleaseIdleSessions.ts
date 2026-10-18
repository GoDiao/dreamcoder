import { useEffect } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useTabStore, type Tab } from '../stores/tabStore'
import { useTerminalPanelStore } from '../stores/terminalPanelStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'

/** Recently opened sessions kept connected so switching back is instant. */
export const MAX_LIVE_SESSIONS = 8

/**
 * Without a tab bar nothing closes sessions the user has browsed away from.
 * Keep the most recent ones live and release older idle sessions: close the
 * connection, drop the right-panel state and terminals, and forget the tab.
 */
export function selectSessionsToRelease(
  tabs: Tab[],
  activeTabId: string | null,
  isBusy: (sessionId: string) => boolean,
  max = MAX_LIVE_SESSIONS,
): string[] {
  const sessionTabs = tabs.filter((tab) => tab.type === 'session')
  let excess = sessionTabs.length - max
  if (excess <= 0) return []
  const released: string[] = []
  // Tabs are ordered most-recently-opened last, so walk from the front.
  for (const tab of sessionTabs) {
    if (excess <= 0) break
    if (tab.sessionId === activeTabId || tab.status === 'running' || isBusy(tab.sessionId)) continue
    released.push(tab.sessionId)
    excess -= 1
  }
  return released
}

export function useReleaseIdleSessions() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)

  useEffect(() => {
    const chatSessions = useChatStore.getState().sessions
    const isBusy = (id: string) => {
      const session = chatSessions[id]
      return !!session && session.chatState !== 'idle'
    }
    const released = selectSessionsToRelease(tabs, activeTabId, isBusy)
    if (released.length === 0) return
    for (const id of released) {
      useChatStore.getState().disconnectSession(id)
      useWorkspacePanelStore.getState().clearSession(id)
      useTerminalPanelStore.getState().clearSession(id)
    }
    useTabStore.getState().dropTabs(released)
  }, [tabs, activeTabId])
}
