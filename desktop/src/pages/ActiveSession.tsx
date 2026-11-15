import { ArrowLeftIcon, BotIcon, CircleCheckIcon, PanelRight } from 'lucide-react'
import { Button } from '../components/shared/ui/button'
import { Tooltip as HintTooltip } from '../components/shared/Tooltip'
import { useEffect } from 'react'
import {
  SCHEDULED_TAB_ID,
  useTabStore,
  type TabType,
} from '../stores/tabStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTeamStore } from '../stores/teamStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import { useTranslation } from '../i18n'
import { SessionConversation, useSessionActive } from '../components/chat/SessionConversation'
import { OpenProjectMenu } from '../components/layout/OpenProjectMenu'
import { SessionHeaderMenu } from '../components/layout/SessionHeaderMenu'
import { TeamStatusBar } from '../components/teams/TeamStatusBar'
import type { SessionListItem } from '../types/session'
import { useMobileViewport } from '../hooks/useMobileViewport'
import { useTitleRow } from '../hooks/useTitleRow'
import { isDesktopRuntime } from '../lib/desktopRuntime'
import { WorkspaceSplit, useWorkspaceSplitState } from '../components/workspace/WorkspaceSplit'

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
  const isActive = useSessionActive(activeTabId)
  const workspaceStatus = useWorkspacePanelStore((state) => activeTabId ? state.statusBySession[activeTabId] : undefined)
  const workspaceStatusLoading = useWorkspacePanelStore((state) =>
    activeTabId ? state.loading.statusBySession[activeTabId] ?? false : false,
  )
  const workspaceStatusError = useWorkspacePanelStore((state) =>
    activeTabId ? state.errors.statusBySession[activeTabId] ?? null : null,
  )

  useEffect(() => {
    if (!canUsePanel || !activeTabId || !session) return
    if (workspaceStatus || workspaceStatusLoading || workspaceStatusError) return
    void useWorkspacePanelStore.getState().loadStatus(activeTabId)
  }, [activeTabId, canUsePanel, session, workspaceStatus, workspaceStatusError, workspaceStatusLoading])

  const t = useTranslation()

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

          <SessionConversation
            sessionId={activeTabId}
            compact={showPanel}
            canStartSideChat={canUsePanel}
            beforeInput={<TeamStatusBar />}
          />
        </div>

      </WorkspaceSplit>
    </div>
  )
}
