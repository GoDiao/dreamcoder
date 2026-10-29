import { ListTodo } from 'lucide-react'
import type { TaskSummaryItem } from '../../types/chat'
import { useTranslation } from '../../i18n'
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '../shared/ui/trace'
import { TaskTraceItems } from './TaskTraceItems'

export function InlineTaskSummary({ tasks }: { tasks: TaskSummaryItem[] }) {
  const t = useTranslation()
  const completed = tasks.filter((task) => task.status === 'completed').length
  return (
    <Trace className="mb-3">
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon><ListTodo /></TraceIcon>
            <TraceTitle>{t('tasks.completed')}</TraceTitle>
            <TraceDescription>{t('tasks.progress', { done: completed, total: tasks.length })}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent><TaskTraceItems tasks={tasks} /></TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
