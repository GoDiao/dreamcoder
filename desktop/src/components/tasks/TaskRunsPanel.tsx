import { CircleAlertIcon, CircleCheckIcon, ExternalLinkIcon, RefreshCwIcon, TimerOffIcon, XIcon, type LucideIcon } from 'lucide-react'
import { LoadingBlock } from '../shared/LoadingBlock'
import { useEffect, useState } from 'react'
import { useTaskStore } from '../../stores/taskStore'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { parseRunOutput } from '../../lib/parseRunOutput'
import type { TaskRun } from '../../types/task'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

function RunOutput({ run }: { run: TaskRun }) {
  const t = useTranslation()

  if (run.error) {
    return (
      <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-sm border border-[var(--color-error)]/20 bg-[var(--color-error-container)]/28 p-2.5 text-xs text-[var(--color-error)]">
        {run.error}
      </div>
    )
  }

  const text = parseRunOutput(run.output || '')

  if (!text) {
    return (
      <div className="mt-2 p-2.5 rounded-sm bg-[var(--color-surface-container)] text-xs text-[var(--color-text-tertiary)] italic">
        {run.sessionId ? t('tasks.outputHintSession') : t('tasks.noOutputText')}
      </div>
    )
  }

  return (
    <div className="mt-2 max-h-48 overflow-y-auto rounded-sm bg-[var(--color-surface-container)] p-2.5">
      <MarkdownRenderer
        content={text}
        variant="compact"
        className="break-words"
      />
    </div>
  )
}

type Props = {
  taskId: string
  onClose: () => void
  refreshKey?: number
}

const STATUS_CONFIG: Record<string, { icon: LucideIcon; color: string }> = {
  running:   { icon: RefreshCwIcon,         color: 'var(--color-warning)' },
  completed: { icon: CircleCheckIcon, color: 'var(--color-success)' },
  failed:    { icon: CircleAlertIcon,        color: 'var(--color-error)' },
  timeout:   { icon: TimerOffIcon,    color: 'var(--color-error)' },
}

export function TaskRunsPanel({ taskId, onClose, refreshKey }: Props) {
  const t = useTranslation()
  const { fetchTaskRuns } = useTaskStore()
  const connectToSession = useChatStore((s) => s.connectToSession)
  const openTab = useTabStore((s) => s.openTab)
  const [runs, setRuns] = useState<TaskRun[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const openSession = (sessionId: string, taskName?: string) => {
    openTab(sessionId, taskName || 'Task Run')
    connectToSession(sessionId)
  }

  const refresh = () => {
    fetchTaskRuns(taskId).then((r) => {
      setRuns(r)
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [taskId, fetchTaskRuns, refreshKey])

  const hasRunning = runs.some((r) => r.status === 'running')
  useEffect(() => {
    if (!hasRunning && refreshKey === 0) return
    let interval = 1000
    let timer = setInterval(refresh, interval)
    const slowDown = setTimeout(() => {
      clearInterval(timer)
      if (hasRunning) {
        timer = setInterval(refresh, 3000)
      }
    }, 10000)
    const stopTimer = hasRunning ? undefined : setTimeout(() => clearInterval(timer), 12000)
    return () => {
      clearInterval(timer)
      clearTimeout(slowDown)
      if (stopTimer) clearTimeout(stopTimer)
    }
  }, [hasRunning, taskId, refreshKey])

  return (
    <div className="mt-2 mb-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--color-surface-container)]">
        <span className="text-xs font-medium text-[var(--color-text-primary)]">{t('tasks.logsTitle')}</span>
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <XIcon aria-hidden="true" size={16} />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <LoadingBlock className="py-6" spinnerClassName="size-4" />
        ) : runs.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">
            {t('tasks.noLogs')}
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border-separator)]">
            {runs.map((run) => {
              const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.failed!
              const isExpanded = expandedId === run.id
              return (
                <div key={run.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <cfg.icon className={`shrink-0 ${run.status === 'running' ? 'animate-spin' : ''}`}
                      style={{ color: cfg.color }} aria-hidden="true" size={16} />

                    <span className="text-xs font-medium" style={{ color: cfg.color }}>
                      {t(`tasks.runStatus.${run.status}` as any)}
                    </span>

                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>

                    {run.durationMs != null && (
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        {t('tasks.duration', { s: Math.round(run.durationMs / 1000) })}
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-2">
                      {run.sessionId && run.status !== 'running' && (
                        <button
                          onClick={() => openSession(run.sessionId!, run.taskName)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--color-brand)] bg-[var(--color-brand)]/8 hover:bg-[var(--color-brand)]/15 rounded-sm transition-colors"
                        >
                          <ExternalLinkIcon aria-hidden="true" size={14} />
                          {t('tasks.openSession')}
                        </button>
                      )}

                      {(run.output || run.error) && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : run.id)}
                          className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                        >
                          {isExpanded ? t('tasks.hideOutput') : t('tasks.viewOutput')}
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <RunOutput run={run} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
