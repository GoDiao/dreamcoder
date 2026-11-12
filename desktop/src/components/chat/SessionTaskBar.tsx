import { ListTodo, X } from 'lucide-react'
import { useCLITaskStore } from '../../stores/cliTaskStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/ui/button'
import { TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '../shared/ui/trace'
import { ChatTraceBar } from './ChatTraceBar'
import { TaskTraceItems } from './TaskTraceItems'

export function SessionTaskBar() {
  const tasks = useCLITaskStore((state) => state.tasks)
  const expanded = useCLITaskStore((state) => state.expanded)
  const toggleExpanded = useCLITaskStore((state) => state.toggleExpanded)
  const completedAndDismissed = useCLITaskStore((state) => state.completedAndDismissed)
  const resetCompletedTasks = useCLITaskStore((state) => state.resetCompletedTasks)
  const t = useTranslation()
  if (tasks.length === 0) return null
  const completedCount = tasks.filter((task) => task.status === 'completed').length
  const allCompleted = completedCount === tasks.length
  if (allCompleted && completedAndDismissed) return null

  return (
    <ChatTraceBar>
      <TraceCollapsible open={expanded} onOpenChange={toggleExpanded}>
        <div className="flex items-center gap-2">
          <TraceCollapsibleTrigger className="flex-1" aria-label={t('tasks.title')}>
            <TraceLine status={tasks.some((task) => task.status === 'in_progress') ? 'running' : undefined}>
              <TraceIcon><ListTodo /></TraceIcon>
              <TraceTitle>{t('tasks.title')}</TraceTitle>
              <TraceDescription>{t('tasks.progress', { done: completedCount, total: tasks.length })}</TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          {allCompleted && <Button variant="ghost" size="icon-xs" aria-label={t('tasks.dismissCompleted')} onClick={() => { void resetCompletedTasks() }}><X /></Button>}
        </div>
        <TraceCollapsibleContent className="max-h-[240px] overflow-y-auto">
          <TaskTraceItems tasks={tasks} />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </ChatTraceBar>
  )
}
