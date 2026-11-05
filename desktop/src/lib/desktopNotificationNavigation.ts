import { useSessionStore } from '../stores/sessionStore'
import { openSessionTab } from './sessionNavigation'
import { SCHEDULED_TAB_ID, useTabStore } from '../stores/tabStore'
import {
  installDesktopNotificationClickListener,
  type DesktopNotificationTarget,
} from './desktopNotifications'

const SCHEDULED_TAB_TITLE = 'Scheduled Tasks'

export function openDesktopNotificationTarget(target: DesktopNotificationTarget): void {
  if (target.type === 'scheduled') {
    useTabStore.getState().openTab(SCHEDULED_TAB_ID, SCHEDULED_TAB_TITLE, 'scheduled')
    return
  }

  const knownTitle = useSessionStore
    .getState()
    .sessions
    .find((session) => session.id === target.sessionId)
    ?.title
  openSessionTab(target.sessionId, target.title || knownTitle || 'Session')
}

export function installDesktopNotificationNavigation(): Promise<() => void> {
  return installDesktopNotificationClickListener(openDesktopNotificationTarget)
}
