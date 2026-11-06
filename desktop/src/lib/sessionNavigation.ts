import { useCallback } from 'react'
import { useTranslation } from '../i18n'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'

export function openSessionTab(sessionId: string, title: string): void {
  useTabStore.getState().openTab(sessionId, title)
  useChatStore.getState().connectToSession(sessionId)
}

export function useSessionLink({ sessionId, sentTitle }: { sessionId: string; sentTitle?: string }) {
  const t = useTranslation()
  const knownTitle = useSessionStore((state) => state.sessions.find((session) => session.id === sessionId)?.title)
  const title = knownTitle || sentTitle || t('session.untitled')
  const open = useCallback(() => openSessionTab(sessionId, title), [sessionId, title])
  return { title, open }
}
