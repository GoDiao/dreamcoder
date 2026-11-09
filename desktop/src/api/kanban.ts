import type { BoardListing, BoardView, KanbanCommand, KanbanEvent } from '@protocol'
import { api } from './client'

export type BoardPoll = { changed: true; view: BoardView } | { changed: false; etag: string }

export type CommandOutcome = { view: BoardView; warnings: string[]; card?: number }

function boardPath(key: string) {
  return `/api/kanban/boards/${encodeURIComponent(key)}`
}

export const kanbanApi = {
  listBoards() {
    return api.get<{ boards: BoardListing[] }>('/api/kanban/boards')
  },

  createBoard(project: string) {
    return api.post<{ view: BoardView }>('/api/kanban/boards', { project })
  },

  view(key: string, since?: string) {
    return api.get<BoardPoll>(since ? `${boardPath(key)}?since=${encodeURIComponent(since)}` : boardPath(key))
  },

  command(key: string, command: KanbanCommand) {
    return api.post<CommandOutcome>(`${boardPath(key)}/commands`, { command })
  },

  history(key: string, card: number) {
    return api.get<{ events: KanbanEvent[] }>(`${boardPath(key)}/cards/${card}/history`)
  },
}
