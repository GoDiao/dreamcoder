import { BotIcon, Target } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from '../../i18n'
import { useChatStore, useSessionField } from '../../stores/chatStore'
import { getSessionTasks, useCLITaskStore } from '../../stores/cliTaskStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTeamStore } from '../../stores/teamStore'
import type { ActiveGoalState } from '../../types/chat'
import { SESSION_VIEW_ATTRIBUTE } from '../../lib/sessionView'
import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { ChatInput } from './ChatInput'
import { MessageList } from './MessageList'
import { PendingReportsBar } from './PendingReportsBar'
import { QueuedMessagesBar } from './QueuedMessagesBar'
import { SessionTaskBar } from './SessionTaskBar'

const TASK_POLL_INTERVAL_MS = 1000

function useSessionRunning(sessionId: string | null) {
  return useChatStore((s) => {
    const chatState = sessionId ? s.sessions[sessionId]?.chatState : undefined
    return chatState !== undefined && chatState !== 'idle'
  })
}

export function useSessionActive(sessionId: string | null) {
  const isRunning = useSessionRunning(sessionId)
  const hasRunningBackgroundTasks = useChatStore((s) => {
    const tasks = sessionId ? s.sessions[sessionId]?.backgroundAgentTasks : undefined
    return tasks ? Object.values(tasks).some((task) => task.status === 'running') : false
  })
  const hasRunningTasks = useCLITaskStore((s) =>
    sessionId ? getSessionTasks(s, sessionId).tasks.some((task) => task.status === 'in_progress') : false,
  )
  return isRunning || hasRunningTasks || hasRunningBackgroundTasks
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

function useSessionTaskPolling(sessionId: string, enabled: boolean) {
  const isRunning = useSessionRunning(sessionId)
  const fetchSessionTasks = useCLITaskStore((s) => s.fetchSessionTasks)
  const hasIncompleteTasks = useCLITaskStore((s) => getSessionTasks(s, sessionId).tasks.some((task) => task.status !== 'completed'))

  useEffect(() => {
    if (!enabled || (!isRunning && !hasIncompleteTasks)) return

    void fetchSessionTasks(sessionId)
    const timer = setInterval(() => {
      void fetchSessionTasks(sessionId)
    }, TASK_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [enabled, fetchSessionTasks, hasIncompleteTasks, isRunning, sessionId])
}

export function SessionConversation({
  sessionId,
  compact = false,
  primary = true,
  beforeInput,
}: {
  sessionId: string
  compact?: boolean
  primary?: boolean
  beforeInput?: ReactNode
}) {
  const t = useTranslation()
  const connectToSession = useChatStore((s) => s.connectToSession)
  const prewarmSession = useChatStore((s) => s.prewarmSession)
  const hasLoadedTranscript = useChatStore((s) => {
    const sessionState = s.sessions[sessionId]
    return Boolean(sessionState && (sessionState.messages.length > 0 || sessionState.streamingText))
  })
  const listedMessageCount = useSessionStore((s) => s.sessions.find((session) => session.id === sessionId)?.messageCount ?? 0)
  const activeGoal = useSessionField(sessionId, 'activeGoal') ?? null
  const memberInfo = useTeamStore((s) => s.getMemberBySessionId(sessionId))
  const isMemberSession = !!memberInfo
  const isActive = useSessionActive(sessionId)
  const isEmpty = primary && !hasLoadedTranscript && listedMessageCount === 0

  useEffect(() => {
    if (isMemberSession) return
    connectToSession(sessionId, { prewarm: primary })
    if (!primary) prewarmSession(sessionId)
  }, [sessionId, isMemberSession, primary, connectToSession, prewarmSession])

  useSessionTaskPolling(sessionId, !isMemberSession)

  const attributes = { [SESSION_VIEW_ATTRIBUTE]: sessionId }

  return (
    <div {...attributes} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ActiveGoalStrip goal={activeGoal} isRunning={isActive} compact={compact} />

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
        <MessageList sessionId={sessionId} compact={compact} />
      )}

      {!isMemberSession && <SessionTaskBar sessionId={sessionId} />}

      {!isMemberSession && <PendingReportsBar sessionId={sessionId} />}

      {!isMemberSession && <QueuedMessagesBar sessionId={sessionId} />}

      {beforeInput}

      <ChatInput
        sessionId={sessionId}
        variant={isEmpty && !isMemberSession && !compact ? 'hero' : 'default'}
        compact={compact}
        primary={primary}
      />
    </div>
  )
}
