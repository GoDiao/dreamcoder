import { Clock } from 'lucide-react'
import { Button } from '../shared/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../shared/ui/empty'
import { useTranslation } from '../../i18n'

export function TaskEmptyState({ onCreateTask }: { onCreateTask: () => void }) {
  const t = useTranslation()
  return (
    <Empty className="py-20">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Clock aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>{t('tasks.emptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('tasks.emptyDesc')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button onClick={onCreateTask}>{t('tasks.newTask')}</Button></EmptyContent>
    </Empty>
  )
}
