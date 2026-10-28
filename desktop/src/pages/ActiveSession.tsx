import { ArrowLeftIcon, BotIcon, CircleCheckIcon, PanelRight, SquareTerminal, Target } from 'lucide-react'
import { usePanelWidthPersistence } from '../hooks/usePanelWidthPersistence'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../components/shared/ui/resizable'
import { Button } from '../components/shared/ui/button'
import { Tooltip as HintTooltip } from '../components/shared/Tooltip'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import {
  SCHEDULED_TAB_ID,
  useTabStore,
  type TabType,
} from '../stores/tabStore'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore, useSessionField } from '../stores/chatStore'
import { useCLITaskStore } from '../stores/cliTaskStore'
import { useTeamStore } from '../stores/teamStore'
import { useUIStore } from '../stores/uiStore'
import {
  WORKSPACE_PANEL_MAX_WIDTH,
  WORKSPACE_PANEL_MIN_CHAT_WIDTH,
  WORKSPACE_PANEL_MIN_WIDTH,
  useWorkspacePanelStore,
} from '../stores/workspacePanelStore'
import { useTranslation } from '../i18n'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { SessionTaskBar } from '../components/chat/SessionTaskBar'
import { OpenProjectMenu } from '../components/layout/OpenProjectMenu'
import { SessionHeaderMenu } from '../components/layout/SessionHeaderMenu'
import { TeamStatusBar } from '../components/teams/TeamStatusBar'
import type { SessionListItem } from '../types/session'
import type { ActiveGoalState } from '../types/chat'
import { useMobileViewport, useViewportQuery } from '../hooks/useMobileViewport'
import { Spinner } from '../components/shared/ui/spinner'
import { isMacOverlayTitlebar } from '../lib/windowChrome'
import { isDesktopRuntime } from '../lib/desktopRuntime'

const WorkspacePanel = lazy(() => import('../components/workspace/WorkspacePanel').then((m) => ({ default: m.WorkspacePanel })))

const TASK_POLL_INTERVAL_MS = 1000
const SIDE_PANEL_CLASS = [
  'relative flex border-l border-[var(--color-border)] bg-[var(--color-surface)]',
  'max-[850px]:absolute max-[850px]:inset-y-0 max-[850px]:right-0 max-[850px]:z-20',
  'max-[850px]:w-[min(380px,100%)]! max-[850px]:max-w-full max-[850px]:shadow-[var(--shadow-dropdown)]',
].join(' ')

function isSessionTabState(activeTabId: string | null, activeTabType: TabType | null | undefined) {
  if (!activeTabId) return false
  if (activeTabType === 'session') return true
  if (activeTabType) return false
  return activeTabId !== SCHEDULED_TAB_ID
}

function getPathName(path: string | null | undefined) {
  if (!path) return undefined
  return path.split(/[\\/]/).filter(Boolean).pop()
}

function getSessionTerminalCwd(session: SessionListItem | undefined) {
  if (!session) return undefined
  if (session.workDir && session.workDirExists !== false) return session.workDir
  return session.projectPath || undefined
}

function ActiveGoalStrip({
  goal,
  isRunning,
  compact,
}: {
  goal: ActiveGoalState | null | undefined
  isRunning: boolean
  compact: boolean
}) {
  const t = useTranslation()
  if (!goal || goal.action === 'completed') return null

  const objective = goal.objective ?? goal.message
  if (!objective) return null

  const statusLabel = isRunning
    ? t('chat.activeGoal.running')
    : goal.status === 'paused'
      ? t('chat.activeGoal.paused')
      : t('chat.activeGoal.active')
  const meta = [
    goal.budget ? t('chat.activeGoal.budget', { value: goal.budget }) : null,
    goal.elapsed ? t('chat.activeGoal.elapsed', { value: goal.elapsed }) : null,
    goal.continuations ? t('chat.activeGoal.continuations', { value: goal.continuations }) : null,
  ].filter((value): value is string => value !== null)

  return (
    <div className="mx-auto w-full max-w-[860px] shrink-0 px-8 pt-2">
      <div
        data-testid="active-goal-strip"
        className={[
          'flex max-w-full items-center gap-2 rounded-[8px] border border-[var(--color-memory-border)] bg-[var(--color-memory-surface)] px-2.5 py-1.5',
          compact ? 'text-[11px]' : 'text-[12px]',
        ].join(' ')}
      >
        <Target size={compact ? 13 : 14} className="shrink-0 text-[var(--color-memory-accent)]" strokeWidth={2.25} aria-hidden="true" />
        <span className="shrink-0 font-semibold text-[var(--color-text-primary)]">
          {t('chat.activeGoal.title')}
        </span>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-memory-accent)]" aria-hidden="true" />
        <span className="shrink-0 text-[var(--color-text-tertiary)]">{statusLabel}</span>
        <HintTooltip content={objective}><span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text-primary)]">
          {objective}
        </span></HintTooltip>
        {meta.length > 0 ? (
          <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)] lg:flex">
            {meta.map((item) => (
              <span key={item} className="max-w-[140px] truncate">{item}</span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function HeaderIconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string
  pressed: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <HintTooltip content={label}><Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={pressed ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}
    >
      {children}
    </Button></HintTooltip>
  )
}

function getSessionProjectName(session: SessionListItem | undefined, repoName: string | null | undefined) {
  if (!session) return repoName ?? undefined
  return getPathName(session.projectRoot)
    ?? repoName
    ?? getPathName(session.workDir)
    ?? getPathName(session.projectPath)
}

export function ActiveSession() {
  const useOverlayPanel = useViewportQuery('(width < 850px)')
  const setPanelWidth = useWorkspacePanelStore((state) => state.setWidth)
  const isMobileLayout = useMobileViewport() && !isDesktopRuntime()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTabType = useTabStore((s) => s.tabs.find((tab) => tab.sessionId === s.activeTabId)?.type ?? null)
  const sessions = useSessionStore((s) => s.sessions)
  const connectToSession = useChatStore((s) => s.connectToSession)
  const isRunning = useChatStore((s) => {
    const chatState = activeTabId ? s.sessions[activeTabId]?.chatState : undefined
    return chatState !== undefined && chatState !== 'idle'
  })
  const hasRunningBackgroundTasks = useChatStore((s) => {
    const tasks = activeTabId ? s.sessions[activeTabId]?.backgroundAgentTasks : undefined
    return tasks ? Object.values(tasks).some((task) => task.status === 'running') : false
  })
  const hasLoadedTranscript = useChatStore((s) => {
    const sessionState = activeTabId ? s.sessions[activeTabId] : undefined
    return Boolean(sessionState && (sessionState.messages.length > 0 || sessionState.streamingText))
  })
  const activeGoal = useSessionField(activeTabId, 'activeGoal') ?? null
  const fetchSessionTasks = useCLITaskStore((s) => s.fetchSessionTasks)
  const trackedTaskSessionId = useCLITaskStore((s) => s.sessionId)
  const hasIncompleteTasks = useCLITaskStore((s) => s.tasks.some((task) => task.status !== 'completed'))
  const hasRunningTasks = useCLITaskStore((s) => s.tasks.some((task) => task.status === 'in_progress'))

  const session = sessions.find((s) => s.id === activeTabId)
  const memberInfo = useTeamStore((s) => activeTabId ? s.getMemberBySessionId(activeTabId) : null)
  const activeTeam = useTeamStore((s) => s.activeTeam)
  const isMemberSession = !!memberInfo
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  // On macOS the header is the window's title row. With the sidebar hidden it
  // starts at the window's edge, under the traffic lights and the sidebar toggle.
  const macTitlebar = isMacOverlayTitlebar()
  const headerStyle = macTitlebar
    ? {
        height: 'var(--titlebar-height)',
        ...(sidebarOpen ? {} : { paddingLeft: 'calc(var(--traffic-lights-end) + 1.75rem + 12px)' }),
      }
    : undefined
  const canUsePanel = Boolean(activeTabId) &&
    isSessionTabState(activeTabId, activeTabType) &&
    !isMemberSession &&
    !isMobileLayout
  const showPanel = useWorkspacePanelStore((state) =>
    canUsePanel && activeTabId ? state.isPanelOpen(activeTabId) : false,
  )
  const panelTab = useWorkspacePanelStore((state) => activeTabId ? state.getPanelTab(activeTabId) : 'files')
  const panelExpanded = useWorkspacePanelStore((state) =>
    showPanel && activeTabId ? state.isPanelExpanded(activeTabId) : false,
  )
  const panelWidth = useWorkspacePanelStore((state) => state.width)
  const { panelRef: workspacePanelRef, onLayoutChanged } = usePanelWidthPersistence(setPanelWidth, showPanel && !panelExpanded && !useOverlayPanel)
  const workspaceStatus = useWorkspacePanelStore((state) => activeTabId ? state.statusBySession[activeTabId] : undefined)
  const workspaceStatusLoading = useWorkspacePanelStore((state) =>
    activeTabId ? state.loading.statusBySession[activeTabId] ?? false : false,
  )
  const workspaceStatusError = useWorkspacePanelStore((state) =>
    activeTabId ? state.errors.statusBySession[activeTabId] ?? null : null,
  )

  useEffect(() => {
    if (activeTabId && !isMemberSession) {
      connectToSession(activeTabId)
    }
  }, [activeTabId, isMemberSession, connectToSession])

  useEffect(() => {
    if (!canUsePanel || !activeTabId || !session) return
    if (workspaceStatus || workspaceStatusLoading || workspaceStatusError) return
    void useWorkspacePanelStore.getState().loadStatus(activeTabId)
  }, [activeTabId, canUsePanel, session, workspaceStatus, workspaceStatusError, workspaceStatusLoading])

  useEffect(() => {
    if (!activeTabId || isMemberSession) return

    const shouldPollTasks =
      isRunning ||
      (trackedTaskSessionId === activeTabId && hasIncompleteTasks)

    if (!shouldPollTasks) return

    void fetchSessionTasks(activeTabId)

    const timer = setInterval(() => {
      void fetchSessionTasks(activeTabId)
    }, TASK_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [
    activeTabId,
    isMemberSession,
    isRunning,
    trackedTaskSessionId,
    hasIncompleteTasks,
    fetchSessionTasks,
  ])

  const t = useTranslation()
  const isEmpty = !hasLoadedTranscript && (session?.messageCount ?? 0) === 0

  const isActive = isRunning ||
    (trackedTaskSessionId === activeTabId && hasRunningTasks) ||
    hasRunningBackgroundTasks

  if (!activeTabId) return null

  const projectName = getSessionProjectName(session, workspaceStatus?.repoName)
  const branch = workspaceStatus?.branch ?? undefined
  const contextLabel = [projectName, branch].filter(Boolean).join(' · ') || undefined
  const openProjectPath = session?.workDirExists !== false ? session?.workDir ?? null : null
  const showHeader = !isMemberSession && !isMobileLayout

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      {showHeader && (
        <header
          data-testid="session-header"
          style={headerStyle}
          className={`window-drag-region flex shrink-0 select-none items-center justify-between gap-4 border-b border-[var(--color-border)] px-6 ${macTitlebar ? '' : 'h-11'}`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <h1 className="truncate text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[var(--color-text-primary)]">
              {session?.title || t('session.untitled')}
            </h1>
            {isActive && (
              <span
                data-testid="session-header-running"
                className="flex shrink-0 items-center gap-1 text-ui-aux text-[var(--color-text-secondary)]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] animate-pulse-dot" />
                {t('session.active')}
              </span>
            )}
          </div>
          {canUsePanel && (
            <div className="flex shrink-0 items-center gap-[3px]">
              {isDesktopRuntime() && <OpenProjectMenu path={openProjectPath} />}
              <HeaderIconButton
                label={t('session.header.terminal')}
                pressed={showPanel && panelTab === 'terminal'}
                onClick={() => useWorkspacePanelStore.getState().togglePanel(activeTabId, 'terminal')}
              >
                <SquareTerminal size={17} strokeWidth={1.9} aria-hidden="true" />
              </HeaderIconButton>
              <HeaderIconButton
                label={t('session.header.files')}
                pressed={showPanel && panelTab === 'files'}
                onClick={() => useWorkspacePanelStore.getState().togglePanel(activeTabId, 'files')}
              >
                <PanelRight size={17} strokeWidth={1.9} aria-hidden="true" />
              </HeaderIconButton>
              <SessionHeaderMenu sessionId={activeTabId} title={session?.title || ''} />
            </div>
          )}
        </header>
      )}

      <ResizablePanelGroup orientation="horizontal" data-testid="active-session-content-row" className="relative min-h-0 min-w-0 flex-1" onLayoutChanged={onLayoutChanged}>
        <ResizablePanel id="conversation-panel" minSize={panelExpanded || useOverlayPanel ? 0 : showPanel ? WORKSPACE_PANEL_MIN_CHAT_WIDTH : 0} maxSize={panelExpanded ? 0 : undefined} className="flex min-h-0">
        <div
          data-testid="active-session-chat-column"
          hidden={panelExpanded}
          className="flex min-w-0 flex-1 flex-col"
        >
          {isMemberSession && (
            <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-container)]">
              <div className="mx-auto max-w-[860px] flex items-center justify-between gap-4 px-8 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    {memberInfo?.status === 'running' && (
                      <span className="flex h-2 w-2 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
                    )}
                    {memberInfo?.status === 'completed' && (
                      <CircleCheckIcon className="shrink-0 text-[var(--color-success)]" aria-hidden="true" size={14} />
                    )}
                    <BotIcon className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" size={14} />
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {memberInfo?.role}
                    </span>
                    {activeTeam && (
                      <span className="text-[10px] text-[var(--color-text-tertiary)]">
                        @ {activeTeam.name}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                    {t('teams.memberSessionHint')}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (activeTeam?.leadSessionId) {
                      useTabStore.getState().openTab(
                        activeTeam.leadSessionId,
                        t('teams.leader'),
                        'session',
                      )
                    }
                  }}
                  disabled={!activeTeam?.leadSessionId}
                  className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50 disabled:hover:text-[var(--color-text-secondary)]"
                >
                  <ArrowLeftIcon aria-hidden="true" size={14} />
                  {t('teams.backToLeader')}
                </button>
              </div>
            </div>
          )}

          <ActiveGoalStrip
            goal={activeGoal}
            isRunning={isActive}
            compact={showPanel}
          />

          {isEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 pb-32">
              <div className="flex max-w-md flex-col items-center text-center">
                {isMemberSession ? (
                  <>
                    <BotIcon className="shrink-0 mb-4 text-[var(--color-text-tertiary)]" aria-hidden="true" size={48} />
                    <p className="text-[var(--color-text-secondary)]">
                      {memberInfo?.status === 'running'
                        ? `${memberInfo.role} ${t('teams.working')}`
                        : t('teams.noMessages')}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-ui-title font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]">
                      {t('empty.title')}
                    </h2>
                    <p className="mt-1.5 text-ui-body text-[var(--color-text-secondary)]">
                      {t('empty.subtitle')}
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <MessageList compact={showPanel} />
          )}

          {!isMemberSession && <SessionTaskBar />}

          <TeamStatusBar />

          <ChatInput
            variant={isEmpty && !isMemberSession && !showPanel ? 'hero' : 'default'}
            compact={showPanel}
          />
        </div>

        </ResizablePanel>
        {showPanel && !panelExpanded && !useOverlayPanel ? <ResizableHandle aria-label={t('workspace.resizePanel')} data-testid="workspace-resize-handle" className="w-1.5" /> : null}
        {showPanel ? (
          <ResizablePanel id="workspace-panel" panelRef={workspacePanelRef} groupResizeBehavior="preserve-pixel-size"
            defaultSize={panelExpanded ? '100%' : useOverlayPanel ? 0 : panelWidth}
            minSize={panelExpanded || useOverlayPanel ? 0 : WORKSPACE_PANEL_MIN_WIDTH}
            maxSize={panelExpanded ? '100%' : useOverlayPanel ? 0 : WORKSPACE_PANEL_MAX_WIDTH}
            data-testid="session-side-panel"
            className={panelExpanded ? 'flex min-w-0' : SIDE_PANEL_CLASS}
          >
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-label={t('common.loading')}
                  className="flex h-full min-h-0 w-full min-w-0 items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-tertiary)]"
                >
                  <Spinner aria-hidden="true" />
                </div>
              }
            >
              <WorkspacePanel
                sessionId={activeTabId}
                terminalCwd={getSessionTerminalCwd(session)}
                contextLabel={contextLabel}
              />
            </Suspense>
          </ResizablePanel>
        ) : null}
      </ResizablePanelGroup>
    </div>
  )
}
