import { useEffect, useRef, useState, type HTMLAttributes } from 'react'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { UpdateChecker } from '../shared/UpdateChecker'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, type SettingsTab } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { CommandPalette } from '../CommandPalette/CommandPalette'
import {
  H5ConnectionRequiredError,
  initializeDesktopServerUrl,
  isH5ConnectionRequiredError,
  isTauriRuntime,
} from '../../lib/desktopRuntime'
import { WindowControls } from './WindowControls'
import { TitlebarSidebarToggle } from './TitlebarSidebarToggle'
import { isMacOverlayTitlebar } from '../../lib/windowChrome'
import { SettingsModal } from '../../pages/Settings'
import { StartupErrorView } from './StartupErrorView'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { H5ConnectionView } from './H5ConnectionView'
import { FirstLaunch } from '../onboarding/FirstLaunch'
import { firstLaunchWasShown, useFirstLaunchGate } from '../onboarding/useFirstLaunchGate'
import { useReleaseIdleSessions } from '../../hooks/useReleaseIdleSessions'
import { useClaudeCodeImportStore } from '../../stores/claudeCodeImportStore'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { useWindowDrag } from '../../hooks/useWindowDrag'
import { useTeamStore } from '../../stores/teamStore'
import type { Tab } from '../../stores/tabStore'

function isChatTab(tab: Tab | undefined) {
  return tab?.type === 'session'
}

export function AppShell() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [h5StartupError, setH5StartupError] = useState<H5ConnectionRequiredError | null>(null)
  const [bootstrapNonce, setBootstrapNonce] = useState(0)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileSidebarMounted, setMobileSidebarMounted] = useState(false)
  const [mobileSidebarVisible, setMobileSidebarVisible] = useState(false)
  const t = useTranslation()
  const tauriRuntime = isTauriRuntime()
  const isMobileShell = useMobileViewport() && !tauriRuntime
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const activeSession = useSessionStore((s) =>
    activeTabId ? s.sessions.find((session) => session.id === activeTabId) ?? null : null,
  )
  const wasMobileShellRef = useRef(false)
  const effectiveSidebarOpen = isMobileShell ? mobileSidebarOpen : sidebarOpen
  const effectiveSidebarMounted = !isMobileShell || mobileSidebarMounted
  const effectiveSidebarVisible = isMobileShell ? mobileSidebarVisible : sidebarOpen
  const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
  const isActiveChatTab = isChatTab(activeTab)
  // Mirrors ContentRouter and ActiveSession: every tab but scheduled tasks is a
  // session page, and a teammate's session has no header.
  const isTeammateSession = useTeamStore((s) => activeTabId ? !!s.getMemberBySessionId(activeTabId) : false)
  const pageHasSessionHeader = !!activeTab && activeTab.type !== 'scheduled' && !isTeammateSession
  const mobileSessionTitle = activeSession?.title || activeTab?.title || t('session.untitled')
  const mobileSessionUpdated = (() => {
    if (!activeSession?.modifiedAt) return ''
    const diff = Date.now() - new Date(activeSession.modifiedAt).getTime()
    if (diff < 60000) return t('session.timeJustNow')
    if (diff < 3600000) return t('session.timeMinutes', { n: Math.floor(diff / 60000) })
    if (diff < 86400000) return t('session.timeHours', { n: Math.floor(diff / 3600000) })
    return t('session.timeDays', { n: Math.floor(diff / 86400000) })
  })()
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  // The settings window is modal: keep keyboard and screen readers out of the page behind it.
  const behindSettingsProps: { inert?: '' } = settingsOpen ? { inert: '' } : {}
  // The desktop app hides a collapsed sidebar and toggles it from the title row.
  const titlebarToggle = tauriRuntime && !isMobileShell
  const macTitlebar = titlebarToggle && isMacOverlayTitlebar()
  const sidebarHiddenProps: HTMLAttributes<HTMLDivElement> & { inert?: '' } =
    (isMobileShell || titlebarToggle) && !effectiveSidebarOpen
      ? { 'aria-hidden': true, inert: '' }
      : behindSettingsProps

  const firstLaunch = useFirstLaunchGate(ready && !startupError && !h5StartupError)

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      if (!cancelled) {
        setReady(false)
        setStartupError(null)
        setH5StartupError(null)
      }

      try {
        console.log('[mem] AppShell:bootstrap:start')
        await initializeDesktopServerUrl()
        console.log('[mem] AppShell:after-init-server')
        await fetchSettings()
        console.log('[mem] AppShell:after-fetch-settings')
        // Decided before the shell renders, so a first launch goes straight to the import offer.
        await useClaudeCodeImportStore.getState().fetchStatus({ openPrompt: true })

        if (!cancelled) {
          setReady(true)
        }

        void (async () => {
          console.log('[mem] AppShell:restoreTabs:start')
          await useTabStore.getState().restoreTabs()
          console.log('[mem] AppShell:restoreTabs:done')
          if (cancelled) return
          // First launch lands on the empty new-session page even if the
          // restore finishes after the user has left the welcome screen.
          if (firstLaunchWasShown()) {
            useTabStore.setState({ activeTabId: null })
            return
          }
          const { activeTabId: activeId, tabs } = useTabStore.getState()
          const activeTab = tabs.find((tab) => tab.sessionId === activeId)
          if (activeId && activeTab?.type === 'session') {
            useChatStore.getState().connectToSession(activeId)
          }
        })().catch(() => {})
      } catch (error) {
        if (!cancelled) {
          if (!tauriRuntime && isH5ConnectionRequiredError(error)) {
            setH5StartupError(error)
            setStartupError(null)
          } else {
            setStartupError(error instanceof Error ? error.message : String(error))
            setH5StartupError(null)
          }
          setReady(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [bootstrapNonce, fetchSettings, tauriRuntime])

  useEffect(() => {
    if (!tauriRuntime) return
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>('native-menu-navigate', (event) => {
          const target = event.payload as SettingsTab | 'settings'
          useUIStore.getState().openSettings(target === 'about' ? 'about' : undefined)
        }),
      )
      .then((fn) => { unlisten = fn })
      .catch(() => {})
    return () => { unlisten?.() }
  }, [])

  useKeyboardShortcuts()
  useReleaseIdleSessions()

  useEffect(() => {
    if (isMobileShell && !wasMobileShellRef.current) {
      setMobileSidebarOpen(false)
      setSidebarOpen(false)
    }
    if (!isMobileShell && wasMobileShellRef.current) {
      setMobileSidebarOpen(false)
    }
    wasMobileShellRef.current = isMobileShell
  }, [isMobileShell, setSidebarOpen])

  useEffect(() => {
    if (!ready || !isMobileShell) return
    if (isChatTab(activeTab) || (!activeTab && !activeTabId)) return
    const nextChatTab = tabs.find(isChatTab)
    if (nextChatTab) {
      setActiveTab(nextChatTab.sessionId)
      return
    }
    useTabStore.setState({ activeTabId: null })
  }, [activeTab, activeTabId, isMobileShell, ready, setActiveTab, tabs])

  useEffect(() => {
    if (!isMobileShell) {
      setMobileSidebarMounted(false)
      setMobileSidebarVisible(false)
      return
    }
    if (mobileSidebarOpen) {
      setMobileSidebarMounted(true)
      const frame = window.requestAnimationFrame(() => setMobileSidebarVisible(true))
      return () => window.cancelAnimationFrame(frame)
    }
    setMobileSidebarVisible(false)
    const timer = window.setTimeout(() => setMobileSidebarMounted(false), 280)
    return () => window.clearTimeout(timer)
  }, [isMobileShell, mobileSidebarOpen])

  const setEffectiveSidebarOpen = (open: boolean) => {
    if (isMobileShell) {
      setMobileSidebarOpen(open)
      setSidebarOpen(open)
      return
    }
    setSidebarOpen(open)
  }

  const toggleEffectiveSidebar = () => {
    if (isMobileShell) {
      setEffectiveSidebarOpen(!mobileSidebarOpen)
      return
    }
    toggleSidebar()
  }

  if (!tauriRuntime && h5StartupError) {
    return (
      <H5ConnectionView
        initialServerUrl={h5StartupError.serverUrl}
        error={h5StartupError.message}
        onConnected={() => setBootstrapNonce((value) => value + 1)}
      />
    )
  }

  if (startupError) {
    return <StartupErrorView error={startupError} />
  }

  if (!ready || firstLaunch.state === 'pending') {
    return (
      <div className="app-shell-viewport flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
        {t('app.launching')}
      </div>
    )
  }

  if (firstLaunch.state === 'open') {
    return <FirstLaunch onFinish={firstLaunch.finish} />
  }

  return (
    <div className={`app-shell app-shell-viewport flex overflow-hidden bg-[var(--color-surface)]${isMobileShell ? ' app-shell--mobile' : ''}${titlebarToggle ? ' app-shell--titlebar-toggle' : ''}`}>
      {macTitlebar ? (
        <TitlebarSidebarToggle
          className="fixed z-[60]"
          style={{ left: 'var(--traffic-lights-end)', top: 'calc((var(--titlebar-height) - 1.75rem) / 2)' }}
        />
      ) : null}
      {isMobileShell && effectiveSidebarMounted ? (
        <button
          type="button"
          data-testid="sidebar-backdrop"
          data-state={effectiveSidebarVisible ? 'open' : 'closed'}
          className="app-shell-backdrop fixed inset-0 z-40 border-0 p-0"
          aria-label={t('sidebar.collapse')}
          onClick={() => setEffectiveSidebarOpen(false)}
        />
      ) : null}
      <div
        id="sidebar-shell"
        data-testid="sidebar-shell"
        data-state={effectiveSidebarVisible ? 'open' : 'closed'}
        data-mobile={isMobileShell ? 'true' : 'false'}
        className={`sidebar-shell${isMobileShell ? ' sidebar-shell--mobile' : ''}`}
        style={isMobileShell ? undefined : { '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
        {...sidebarHiddenProps}
      >
        {effectiveSidebarMounted ? (
          <Sidebar isMobile={isMobileShell} onRequestClose={() => setEffectiveSidebarOpen(false)} />
        ) : null}
      </div>
      {!isMobileShell && effectiveSidebarOpen ? (
        <SidebarResizeHandle width={sidebarWidth} setWidth={setSidebarWidth} inert={settingsOpen} />
      ) : null}
      <main
        id="content-area"
        data-sidebar-state={effectiveSidebarVisible ? 'open' : 'closed'}
        className={`min-w-0 flex-1 flex flex-col overflow-hidden${isMobileShell ? ' app-shell-main--mobile' : ''}`}
      >
        {/* Kept outside the inert area and above the settings overlay so the
            window can still be moved, minimised or closed while settings is open.
            On macOS a session's header is the title row itself, so the strip is
            only needed there while settings covers that header; it then floats
            over the header instead of pushing the page down. */}
        {titlebarToggle && (!(macTitlebar && pageHasSessionHeader) || settingsOpen) ? (
          <WindowDragStrip
            tall={!pageHasSessionHeader}
            mac={macTitlebar}
            floating={macTitlebar && pageHasSessionHeader}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" {...behindSettingsProps}>
        {isMobileShell ? (
          <div
            data-testid="mobile-session-header"
            className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            <button
              type="button"
              data-testid="mobile-sidebar-toggle"
              aria-controls="sidebar-shell"
              aria-expanded={effectiveSidebarOpen}
              aria-label={effectiveSidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
              onClick={toggleEffectiveSidebar}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            >
              <span className="material-symbols-outlined text-[20px]">
                {effectiveSidebarOpen ? 'close' : 'menu'}
              </span>
            </button>
            {isActiveChatTab ? (
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[15px] font-bold leading-tight text-[var(--color-text-primary)]">
                  {mobileSessionTitle}
                </h1>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10px] font-medium text-[var(--color-text-tertiary)]">
                  {activeTab?.status === 'running' ? (
                    <span className="flex shrink-0 items-center gap-1 text-[var(--color-text-secondary)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] animate-pulse-dot" />
                      {t('session.active')}
                    </span>
                  ) : null}
                  {activeSession?.messageCount !== undefined && activeSession.messageCount > 0 ? (
                    <>
                      {activeTab?.status === 'running' ? <span aria-hidden="true">·</span> : null}
                      <span>
                        {activeSession.messageCountExact === false
                          ? t('session.messagesAtLeast', { count: activeSession.messageCount })
                          : t('session.messages', { count: activeSession.messageCount })}
                      </span>
                    </>
                  ) : null}
                  {mobileSessionUpdated ? (
                    <>
                      {(activeTab?.status === 'running') || ((activeSession?.messageCount ?? 0) > 0) ? <span aria-hidden="true">·</span> : null}
                      <span className="truncate">{t('session.lastUpdated', { time: mobileSessionUpdated })}</span>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <ContentRouter />
        </div>
      </main>
      <SettingsModal />
      <ToastContainer />
      <CommandPalette />
      <UpdateChecker />
    </div>
  )
}

/**
 * Window drag area above the page content (the tab bar used to provide it).
 * On macOS it is the title row of pages without a session header, lined up with
 * the traffic lights; the sidebar toggle floats over it. Elsewhere it holds the
 * sidebar toggle and, on Windows, the window buttons: slim above a session,
 * whose header also moves the window, and as tall as that header otherwise.
 */
function WindowDragStrip({ tall, mac, floating = false }: { tall: boolean; mac: boolean; floating?: boolean }) {
  const handleDrag = useWindowDrag()
  return (
    <div
      data-testid="window-drag-strip"
      onMouseDown={handleDrag}
      style={mac ? { height: 'var(--titlebar-height)' } : undefined}
      className={`${floating ? 'fixed inset-x-0 top-0' : 'relative'} z-[60] flex shrink-0 items-stretch select-none ${mac ? '' : tall ? 'h-11' : 'h-8'}`}
    >
      {mac ? null : (
        <div className="flex items-center pl-3">
          <TitlebarSidebarToggle />
        </div>
      )}
      <div aria-hidden="true" className="min-w-0 flex-1" />
      <WindowControls />
    </div>
  )
}

const SIDEBAR_RESIZE_STEP = 10

function SidebarResizeHandle({ width, setWidth, inert = false }: { width: number; setWidth: (w: number) => void; inert?: boolean }) {
  const [dragState, setDragState] = useState<{ startX: number; startWidth: number } | null>(null)
  const dragStateRef = useRef(dragState)

  useEffect(() => {
    dragStateRef.current = dragState
  }, [dragState])

  useEffect(() => {
    if (!dragState) return

    const handlePointerMove = (event: PointerEvent) => {
      const current = dragStateRef.current
      if (!current) return
      setWidth(current.startWidth + (event.clientX - current.startX))
    }

    const handlePointerUp = () => {
      setDragState(null)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [dragState, setWidth])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={inert ? -1 : 0}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        setDragState({ startX: event.clientX, startWidth: width })
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          setWidth(width + SIDEBAR_RESIZE_STEP)
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          setWidth(width - SIDEBAR_RESIZE_STEP)
        }
      }}
      className="group relative z-10 flex w-1.5 shrink-0 cursor-col-resize items-stretch justify-center outline-none transition-colors hover:bg-[var(--color-border-focus)]/30 focus-visible:bg-[var(--color-surface-container)]"
    />
  )
}
