import { useEffect, useRef } from 'react'
import { useNewSessionStore } from '../stores/newSessionStore'
import { useChatStore } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import {
  getAppZoomKeyboardAction,
  nextAppZoomLevel,
} from '../lib/appZoom'
import { useSettingsStore } from '../stores/settingsStore'
import { focusedSessionViewId } from '../lib/sessionView'

export function useKeyboardShortcuts() {
  const openNewSession = useNewSessionStore((s) => s.open)
  const openModal = useUIStore((s) => s.openModal)
  const closeModal = useUIStore((s) => s.closeModal)
  const activeModal = useUIStore((s) => s.activeModal)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const uiZoom = useSettingsStore((s) => s.uiZoom)
  const setUiZoom = useSettingsStore((s) => s.setUiZoom)

  const activeModalRef = useRef(activeModal)
  activeModalRef.current = activeModal
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const appZoomLevelRef = useRef(uiZoom)
  appZoomLevelRef.current = uiZoom

  useEffect(() => {
    const handleQuickSwitcher = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat && !activeModalRef.current && !document.querySelector('[aria-modal="true"]')) {
          openModal('command-palette')
        }
        return
      }
    }

    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return
      const meta = e.metaKey || e.ctrlKey

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

      if (meta && e.key === 'n') {
        e.preventDefault()
        openNewSession()
      }

      if (e.key === 'Escape') {
        if (activeModalRef.current) {
          closeModal()
        }
      }

      if (meta && e.key === '.') {
        const sessionId = focusedSessionViewId() ?? activeTabIdRef.current
        const chatState = sessionId ? useChatStore.getState().sessions[sessionId]?.chatState ?? 'idle' : 'idle'
        if (sessionId && chatState !== 'idle') {
          e.preventDefault()
          stopGeneration(sessionId)
        }
      }
    }

    document.addEventListener('keydown', handleQuickSwitcher, true)
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handleQuickSwitcher, true)
      document.removeEventListener('keydown', handler)
    }
  }, [closeModal, openModal, openNewSession, setUiZoom, stopGeneration])
}
