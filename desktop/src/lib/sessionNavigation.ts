import { useCallback } from 'react'
import { useTranslation } from '../i18n'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { findSideChatParent, useWorkspacePanelStore } from '../stores/workspacePanelStore'

export function openSessionTab(sessionId: string, title: string): void {
  const panels = useWorkspacePanelStore.getState()
  const parentId = findSideChatParent(panels.panelByTab, sessionId)
  const tabSessionId = parentId ?? sessionId
  const tabTitle = parentId
    ? useSessionStore.getState().sessions.find((session) => session.id === parentId)?.title ?? title
    : title
  useTabStore.getState().openTab(tabSessionId, tabTitle)
  useChatStore.getState().connectToSession(tabSessionId)
  if (parentId) panels.openTab(parentId, { kind: 'sideChat', sessionId })
}

export function useSessionLink({ sessionId, sentTitle }: { sessionId: string; sentTitle?: string }) {
  const t = useTranslation()
  const knownTitle = useSessionStore((state) => state.sessions.find((session) => session.id === sessionId)?.title)
  const title = knownTitle || sentTitle || t('session.untitled')
  const open = useCallback(() => openSessionTab(sessionId, title), [sessionId, title])
  return { title, open }
}
