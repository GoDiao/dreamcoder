import { ArrowLeftIcon, BotIcon, CircleCheckIcon, PanelRight, Target } from 'lucide-react'
import { Button } from '../components/shared/ui/button'
import { Tooltip as HintTooltip } from '../components/shared/Tooltip'
import { useEffect } from 'react'
import {
  SCHEDULED_TAB_ID,
  useTabStore,
  type TabType,
} from '../stores/tabStore'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore, useSessionField } from '../stores/chatStore'
import { useCLITaskStore } from '../stores/cliTaskStore'
import { useTeamStore } from '../stores/teamStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { useTranslation } from '../i18n'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { SessionTaskBar } from '../components/chat/SessionTaskBar'
import { PendingReportsBar } from '../components/chat/PendingReportsBar'
import { QueuedMessagesBar } from '../components/chat/QueuedMessagesBar'
import { OpenProjectMenu } from '../components/layout/OpenProjectMenu'
import { SessionHeaderMenu } from '../components/layout/SessionHeaderMenu'
import { TeamStatusBar } from '../components/teams/TeamStatusBar'
import type { SessionListItem } from '../types/session'
import type { ActiveGoalState } from '../types/chat'
import { useMobileViewport } from '../hooks/useMobileViewport'
import { useTitleRow } from '../hooks/useTitleRow'
import { isDesktopRuntime } from '../lib/desktopRuntime'
import { WorkspaceSplit, useWorkspaceSplitState } from '../components/workspace/WorkspaceSplit'

const TASK_POLL_INTERVAL_MS = 1000

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
          'flex max-w-full items-center gap-2 rounded-lg border border-memory-border bg-memory-surface px-2.5 py-1.5',
          compact ? 'text-2xs' : 'text-xs',
        ].join(' ')}
      >
        <Target size={compact ? 13 : 14} className="shrink-0 text-memory" strokeWidth={2.25} aria-hidden="true" />
        <span className="shrink-0 font-semibold text-foreground">
          {t('chat.activeGoal.title')}
        </span>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-memory" aria-hidden="true" />
        <span className="shrink-0 text-subtle-foreground">{statusLabel}</span>
        <HintTooltip content={objective}><span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {objective}
        </span></HintTooltip>
        {meta.length > 0 ? (
          <span className="hidden shrink-0 items-center gap-1.5 text-2xs text-subtle-foreground lg:flex">
            {meta.map((item) => (
              <span key={item} className="max-w-[140px] truncate">{item}</span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
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
  const { style: titleRowStyle, className: titleRowClass } = useTitleRow()
  const canUsePanel = Boolean(activeTabId) &&
    isSessionTabState(activeTabId, activeTabType) &&
    !isMemberSession &&
    !isMobileLayout
  const { showPanel, panelExpanded } = useWorkspaceSplitState(activeTabId, canUsePanel)
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
    <div className="relative flex flex-1 flex-col overflow-hidden bg-background text-foreground">
      <WorkspaceSplit
        showPanel={showPanel}
        panelExpanded={panelExpanded}
        testId="active-session-content-row"
        panel={{
          panelId: activeTabId,
          sessionTitle: session?.title || t('session.untitled'),
          terminalCwd: getSessionTerminalCwd(session),
          contextLabel,
          projectRoot: openProjectPath,
        }}
      >
        <div
          data-testid="active-session-chat-column"
          hidden={panelExpanded}
          className="flex min-w-0 flex-1 flex-col"
        >
          {showHeader && (
            <header
              data-testid="session-header"
              style={titleRowStyle(true)}
              className={`window-drag-region flex shrink-0 select-none items-center justify-between gap-4 border-b border-border px-6 ${titleRowClass}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <h1 className="truncate text-base font-semibold leading-snug tracking-tight text-foreground">
                  {session?.title || t('session.untitled')}
                </h1>
                {isActive && (
                  <span
                    data-testid="session-header-running"
                    className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-dot" />
                    {t('session.active')}
                  </span>
                )}
              </div>
              {canUsePanel && (
                <div className="flex shrink-0 items-center gap-0.75">
                  {isDesktopRuntime() && <OpenProjectMenu path={openProjectPath} />}
                  <SessionHeaderMenu sessionId={activeTabId} title={session?.title || ''} />
                  {!showPanel && (
                    <HintTooltip content={t('workspace.openSidePanel')}>
                      <Button
                        variant="ghost-muted"
                        size="icon-sm"
                        aria-label={t('workspace.openSidePanel')}
                        onClick={() => useWorkspacePanelStore.getState().togglePanel(activeTabId)}
                      >
                        <PanelRight size={17} strokeWidth={1.9} aria-hidden="true" />
                      </Button>
                    </HintTooltip>
                  )}
                </div>
              )}
            </header>
          )}

          {isMemberSession && (
            <div className="shrink-0 border-b border-border bg-muted">
              <div className="mx-auto max-w-[860px] flex items-center justify-between gap-4 px-8 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    {memberInfo?.status === 'running' && (
                      <span className="flex h-2 w-2 rounded-full bg-warning animate-pulse-dot" />
                    )}
                    {memberInfo?.status === 'completed' && (
                      <CircleCheckIcon className="shrink-0 text-success" aria-hidden="true" size={14} />
                    )}
                    <BotIcon className="shrink-0 text-subtle-foreground" aria-hidden="true" size={14} />
                    <span className="text-sm font-semibold text-foreground">
                      {memberInfo?.role}
                    </span>
                    {activeTeam && (
                      <span className="text-3xs text-subtle-foreground">
                        @ {activeTeam.name}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-2xs text-subtle-foreground">
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
                  className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:hover:text-muted-foreground"
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
                    <BotIcon className="shrink-0 mb-4 text-subtle-foreground" aria-hidden="true" size={48} />
                    <p className="text-muted-foreground">
                      {memberInfo?.status === 'running'
                        ? `${memberInfo.role} ${t('teams.working')}`
                        : t('teams.noMessages')}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-xl font-semibold tracking-tight text-foreground">
                      {t('empty.title')}
                    </h2>
                    <p className="mt-1.5 text-sm text-muted-foreground">
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

          {!isMemberSession && <PendingReportsBar sessionId={activeTabId} />}

          {!isMemberSession && <QueuedMessagesBar sessionId={activeTabId} />}

          <TeamStatusBar />

          <ChatInput
            variant={isEmpty && !isMemberSession && !showPanel ? 'hero' : 'default'}
            compact={showPanel}
          />
        </div>

      </WorkspaceSplit>
    </div>
  )
}
