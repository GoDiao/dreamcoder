import { KanbanCommandSchema } from '../../entrypoints/sdk/controlSchemas.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { KanbanError } from '../services/kanbanService.js'
import { kanban } from '../ws/handler.js'
import { readBody, requireString } from './requestBody.js'

const HUMAN = { kind: 'human' } as const

function toApiError(error: unknown): unknown {
  return error instanceof KanbanError ? new ApiError(error.status, error.message, error.code) : error
}

function cardId(value: string | undefined): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Card id must be a positive integer')
  return id
}

export async function handleKanbanApi(req: Request, url: URL, segments: string[]): Promise<Response> {
  try {
    const [, , collection, key, child, childId, leaf] = segments
    const method = req.method

    if (collection !== 'boards') throw ApiError.notFound(`Unknown kanban resource: ${collection ?? ''}`)

    if (!key) {
      if (method === 'GET') return Response.json({ boards: await kanban.listBoards() })
      if (method === 'POST') {
        const body = await readBody(req)
        const view = await kanban.createBoard(requireString(body, 'project'))
        return Response.json({ view }, { status: 201 })
      }
    }

    if (key && !child && method === 'GET') {
      const view = await kanban.view(key, HUMAN)
      const since = url.searchParams.get('since')
      return Response.json(since && since === view.etag ? { changed: false, etag: view.etag } : { changed: true, view })
    }

    if (key && child === 'commands' && !childId && method === 'POST') {
      const body = await readBody(req)
      const parsed = KanbanCommandSchema().safeParse(body.command)
      if (!parsed.success) throw ApiError.badRequest(`Invalid command: ${parsed.error.issues[0]?.message ?? 'unknown shape'}`)
      const { view, warnings, card } = await kanban.execute(key, parsed.data, HUMAN)
      return Response.json({ view, warnings, ...(card === undefined ? {} : { card }) })
    }

    if (key && child === 'cards' && childId && leaf === 'history' && method === 'GET') {
      return Response.json({ events: await kanban.history(key, cardId(childId)) })
    }

    throw new ApiError(405, `Method ${method} not allowed on ${url.pathname}`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    return errorResponse(toApiError(error))
  }
}
