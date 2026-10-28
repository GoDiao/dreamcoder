import { CheckCircle2, Circle, CircleDot, UserRound } from 'lucide-react'
import type { CLITask } from '../../types/cliTask'
import { TraceDescription, TraceIcon, TraceLine, TraceTitle } from '../shared/ui/trace'

type Task = Pick<CLITask, 'id' | 'subject' | 'status' | 'activeForm' | 'owner'>
const icons = { pending: Circle, in_progress: CircleDot, completed: CheckCircle2 }

export function TaskTraceItems({ tasks }: { tasks: Task[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => {
        const Icon = icons[task.status]
        return (
          <li key={task.id} className="flex min-w-0 flex-col gap-1">
            <TraceLine status={task.status === 'in_progress' ? 'running' : task.status === 'pending' ? 'pending' : undefined}>
              <TraceIcon><Icon /></TraceIcon>
              <TraceDescription>#{task.id}</TraceDescription>
              <TraceTitle className={task.status === 'completed' ? 'line-through' : undefined}>{task.subject}</TraceTitle>
            </TraceLine>
            {task.status === 'in_progress' && task.activeForm && <TraceDescription className="ml-6 text-xs">{task.activeForm}</TraceDescription>}
            {task.owner && <TraceLine className="ml-6 text-xs"><TraceIcon><UserRound /></TraceIcon><TraceDescription>{task.owner}</TraceDescription></TraceLine>}
          </li>
        )
      })}
    </ul>
  )
}
