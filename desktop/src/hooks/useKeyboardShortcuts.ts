import { useEffect, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import {
  getAppZoomKeyboardAction,
  nextAppZoomLevel,
} from '../lib/appZoom'
import { useSettingsStore } from '../stores/settingsStore'

export function useKeyboardShortcuts() {
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const openModal = useUIStore((s) => s.openModal)
  const closeModal = useUIStore((s) => s.closeModal)
  const activeModal = useUIStore((s) => s.activeModal)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const chatState = useChatStore((s) => activeTabId ? s.sessions[activeTabId]?.chatState ?? 'idle' : 'idle')
  const uiZoom = useSettingsStore((s) => s.uiZoom)
  const setUiZoom = useSettingsStore((s) => s.setUiZoom)

  const activeModalRef = useRef(activeModal)
  activeModalRef.current = activeModal
  const chatStateRef = useRef(chatState)
  chatStateRef.current = chatState
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const appZoomLevelRef = useRef(uiZoom)
  appZoomLevelRef.current = uiZoom

  useEffect(() => {
    const handleQuickSwitcher = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return
      const meta = e.metaKey || e.ctrlKey
      // Capture before the terminal consumes Ctrl+K as a control character.
      if (meta && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat && !activeModalRef.current && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
          openModal('command-palette')
        }
        return
      }
    }

    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return
      const meta = e.metaKey || e.ctrlKey

      // The palette owns its keyboard interaction while it is open.
      if (activeModalRef.current === 'command-palette') {
        if (meta && (e.key === 'n' || e.key === '.')) e.preventDefault()
        return
      }

      const zoomAction = getAppZoomKeyboardAction(e)
      if (zoomAction) {
        e.preventDefault()
        const nextZoom = nextAppZoomLevel(appZoomLevelRef.current, zoomAction)
        appZoomLevelRef.current = nextZoom
        setUiZoom(nextZoom)
        return
      }

      // Cmd+N — New session
      if (meta && e.key === 'n') {
        e.preventDefault()
        setActiveSession(null)
        setActiveView('code')
      }

      // Escape — Close modal or clear state
      if (e.key === 'Escape') {
        if (activeModalRef.current) {
          closeModal()
        }
      }

      // Cmd+. — Stop generation
      if (meta && e.key === '.') {
        if (chatStateRef.current !== 'idle' && activeTabIdRef.current) {
          e.preventDefault()
          stopGeneration(activeTabIdRef.current)
        }
      }
    }

    document.addEventListener('keydown', handleQuickSwitcher, true)
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handleQuickSwitcher, true)
      document.removeEventListener('keydown', handler)
    }
  }, [closeModal, openModal, setActiveSession, setActiveView, setUiZoom, stopGeneration])
}
