import { useCallback } from 'react'
import { toast } from 'sonner'
import type { KanbanCommand } from '@protocol'
import { useTranslation } from '../../i18n'
import { useKanbanStore } from '../../stores/kanbanStore'
import { kanbanErrorMessage } from './board'

export function useKanbanCommand(board: string) {
  const t = useTranslation()
  const execute = useKanbanStore((state) => state.execute)
  return useCallback(async (command: KanbanCommand, onError?: (message: string) => void): Promise<{ card?: number } | null> => {
    try {
      const { warnings, card } = await execute(board, command)
      for (const warning of warnings) toast.warning(t('kanban.warning', { message: warning }))
      return card === undefined ? {} : { card }
    } catch (error) {
      const message = kanbanErrorMessage(t, error)
      if (onError) onError(message)
      else toast.error(message)
      return null
    }
  }, [board, execute, t])
}
