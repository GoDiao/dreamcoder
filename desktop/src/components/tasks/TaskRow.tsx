import { CirclePauseIcon, CirclePlayIcon, EllipsisVerticalIcon, PencilIcon, PlayIcon, RefreshCwIcon, ScrollTextIcon, Trash2Icon } from 'lucide-react'
import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { useState } from 'react'
import { ActionMenu } from '../shared/ActionMenu'
import { Button } from '../shared/ui/button'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { CronTask } from '../../types/task'
import { useTaskStore } from '../../stores/taskStore'
import { useTranslation } from '../../i18n'
import { describeCron } from '../../lib/cronDescribe'
import { TaskRunsPanel } from './TaskRunsPanel'
import { NewTaskModal } from './NewTaskModal'

type Props = {
  task: CronTask
  showLogs: boolean
  onToggleLogs: () => void
}

type ConfirmAction = 'run' | 'toggle' | 'delete' | null

export function TaskRow({ task, showLogs, onToggleLogs }: Props) {
  const deleteTask = useTaskStore((state) => state.deleteTask)
  const updateTask = useTaskStore((state) => state.updateTask)
  const runTask = useTaskStore((state) => state.runTask)
  const t = useTranslation()
  const [showEdit, setShowEdit] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [logsRefreshKey, setLogsRefreshKey] = useState(0)
  const isRunning = submitting && confirmAction === 'run'
  const confirmLabel = confirmAction === 'run'
    ? t('tasks.runNow')
    : confirmAction === 'toggle'
      ? task.enabled ? t('common.disable') : t('common.enable')
      : t('common.delete')
  const confirmMessage = confirmAction === 'run'
    ? t('tasks.confirmRun')
    : confirmAction === 'toggle'
      ? task.enabled ? t('tasks.confirmDisable') : t('tasks.confirmEnable')
      : t('tasks.confirmDelete')

  const requestConfirmation = (action: ConfirmAction) => {
    setActionError(null)
    setConfirmAction(action)
  }

  const handleConfirm = async () => {
    if (!confirmAction || submitting) return
    setSubmitting(true)
    setActionError(null)
    try {
      if (confirmAction === 'run') {
        if (!showLogs) onToggleLogs()
        await runTask(task.id)
        setLogsRefreshKey((key) => key + 1)
      } else if (confirmAction === 'toggle') {
        await updateTask(task.id, { enabled: !task.enabled })
      } else {
        await deleteTask(task.id)
      }
      setConfirmAction(null)
    } catch (error) {
      setActionError(t('tasks.actionFailed', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setSubmitting(false)
    }
  }

  const ToggleIcon = task.enabled ? CirclePauseIcon : CirclePlayIcon
  const RunIcon = isRunning ? RefreshCwIcon : PlayIcon
  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between px-4 py-3 hover:bg-hover transition-colors group">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${task.enabled ? 'bg-success' : 'bg-subtle-foreground'}`} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{task.name}</div>
            {task.description && (
              <div className="text-xs text-muted-foreground truncate">{task.description}</div>
            )}
            <div className="flex items-center gap-3 text-2xs text-subtle-foreground mt-0.5">
              <span>{t('tasks.createdAt')}{new Date(task.createdAt).toLocaleDateString()}</span>
              {task.lastFiredAt && (
                <span>{t('tasks.lastRunAt')}{new Date(task.lastFiredAt).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <HintTooltip content={task.cron}><span className="text-xs text-subtle-foreground">
            {describeCron(task.cron, t)}
          </span></HintTooltip>

          <div className="flex items-center gap-0.5">
            <HintTooltip content={task.enabled ? t('tasks.runNow') : undefined}>
              <Button
                variant="ghost-muted"
                size="icon-sm"
                onClick={() => requestConfirmation('run')}
                disabled={submitting || !task.enabled}
                aria-label={t('tasks.runNow')}
              >
                <RunIcon className={`${isRunning ? 'animate-spin ' : ''}${task.enabled ? 'text-primary' : ''}`} aria-hidden="true" size={18} />
              </Button>
            </HintTooltip>

            <HintTooltip content={t('tasks.viewLogs')}>
              <Button
                variant="ghost-muted"
                size="icon-sm"
                onClick={onToggleLogs}
                aria-pressed={showLogs}
                aria-label={t('tasks.viewLogs')}
              >
                <ScrollTextIcon className={showLogs ? 'text-primary' : ''} aria-hidden="true" size={18} />
              </Button>
            </HintTooltip>

            <ActionMenu
              label={t('tasks.actions')}
              trigger={<Button variant="ghost-muted" size="icon-sm" aria-label={t('tasks.actions')} disabled={submitting}>
                <EllipsisVerticalIcon aria-hidden="true" size={18} />
              </Button>}
              actions={[
                { id: 'edit', label: t('tasks.edit'), icon: <PencilIcon aria-hidden="true" />, afterClose: true, onSelect: () => setShowEdit(true) },
                { id: 'toggle', label: task.enabled ? t('common.disable') : t('common.enable'), icon: <ToggleIcon aria-hidden="true" />, afterClose: true, onSelect: () => requestConfirmation('toggle') },
                { id: 'delete', label: t('common.delete'), icon: <Trash2Icon aria-hidden="true" />, danger: true, separatorBefore: true, afterClose: true, onSelect: () => requestConfirmation('delete') },
              ]}
            />
          </div>
        </div>
      </div>

      {confirmAction !== null && <ConfirmDialog
        open
        onClose={() => requestConfirmation(null)}
        onConfirm={handleConfirm}
        title={confirmLabel}
        body={<><p>{task.name}</p><p>{confirmMessage}</p>{actionError && <p role="alert" className="text-destructive">{actionError}</p>}</>}
        confirmLabel={confirmLabel}
        cancelLabel={t('common.cancel')}
        confirmVariant={confirmAction === 'delete' ? 'destructive' : 'default'}
        loading={submitting}
      />}

      {showLogs && (
        <div className="px-4 pb-3">
          <TaskRunsPanel taskId={task.id} onClose={onToggleLogs} refreshKey={logsRefreshKey} />
        </div>
      )}

      {showEdit && (
        <NewTaskModal open editTask={task} onClose={() => setShowEdit(false)} />
      )}
    </div>
  )
}
