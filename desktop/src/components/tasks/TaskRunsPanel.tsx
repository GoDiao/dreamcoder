import { CircleAlertIcon, CircleCheckIcon, ExternalLinkIcon, RefreshCwIcon, TimerOffIcon, XIcon, type LucideIcon } from 'lucide-react'
import { LoadingBlock } from '../shared/LoadingBlock'
import { useEffect, useState } from 'react'
import { useTaskStore } from '../../stores/taskStore'
import { openSessionTab } from '../../lib/sessionNavigation'
import { useTranslation } from '../../i18n'
import { parseRunOutput } from '../../lib/parseRunOutput'
import type { TaskRun } from '../../types/task'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

function RunOutput({ run }: { run: TaskRun }) {
  const t = useTranslation()

  if (run.error) {
    return (
      <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-sm border border-destructive/20 bg-destructive-surface/28 p-2.5 text-xs text-destructive">
        {run.error}
      </div>
    )
  }

  const text = parseRunOutput(run.output || '')

  if (!text) {
    return (
      <div className="mt-2 p-2.5 rounded-sm bg-muted text-xs text-subtle-foreground italic">
        {run.sessionId ? t('tasks.outputHintSession') : t('tasks.noOutputText')}
      </div>
    )
  }

  return (
    <div className="mt-2 max-h-48 overflow-y-auto rounded-sm bg-muted p-2.5">
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
  running:   { icon: RefreshCwIcon,         color: 'var(--warning)' },
  completed: { icon: CircleCheckIcon, color: 'var(--success)' },
  failed:    { icon: CircleAlertIcon,        color: 'var(--destructive)' },
  timeout:   { icon: TimerOffIcon,    color: 'var(--destructive)' },
}

export function TaskRunsPanel({ taskId, onClose, refreshKey }: Props) {
  const t = useTranslation()
  const { fetchTaskRuns } = useTaskStore()
  const [runs, setRuns] = useState<TaskRun[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
    <div className="mt-2 mb-1 rounded-md border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted">
        <span className="text-xs font-medium text-foreground">{t('tasks.logsTitle')}</span>
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="p-0.5 text-subtle-foreground hover:text-foreground transition-colors"
        >
          <XIcon aria-hidden="true" size={16} />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <LoadingBlock className="py-6" spinnerClassName="size-4" />
        ) : runs.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-subtle-foreground">
            {t('tasks.noLogs')}
          </div>
        ) : (
          <div className="divide-y divide-border">
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

                    <span className="text-xs text-subtle-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>

                    {run.durationMs != null && (
                      <span className="text-xs text-subtle-foreground">
                        {t('tasks.duration', { s: Math.round(run.durationMs / 1000) })}
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-2">
                      {run.sessionId && run.status !== 'running' && (
                        <button
                          onClick={() => openSessionTab(run.sessionId!, run.taskName || 'Task Run')}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary bg-primary/8 hover:bg-primary/15 rounded-sm transition-colors"
                        >
                          <ExternalLinkIcon aria-hidden="true" size={14} />
                          {t('tasks.openSession')}
                        </button>
                      )}

                      {(run.output || run.error) && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : run.id)}
                          className="text-xs text-subtle-foreground hover:text-muted-foreground transition-colors"
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
