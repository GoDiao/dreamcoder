import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { sessionService } from '../services/sessionService.js'

const sessionStates = new Map<string, 'idle' | 'thinking' | 'compacting' | 'tool_executing'>()

export async function handleConversationsApi(
  req: Request,
  url: URL,
  segments: string[]
): Promise<Response> {
  try {
    let sessionId: string | undefined
    let subAction: string | undefined

    if (segments[1] === 'sessions') {
      sessionId = segments[2]
      subAction = segments[4]
    } else {
      sessionId = segments[2]
      subAction = segments[3]
    }

    if (!sessionId) {
      throw ApiError.badRequest('Session ID is required')
    }

    if (subAction === 'status' && req.method === 'GET') {
      return getChatStatus(sessionId)
    }

    if (subAction === 'stop' && req.method === 'POST') {
      return stopChat(sessionId)
    }

    if (!subAction) {
      if (req.method !== 'POST') {
        return Response.json(
          { error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
          { status: 405 }
        )
      }
      return await sendMessage(req, sessionId)
    }

    return Response.json(
      { error: 'NOT_FOUND', message: `Unknown chat sub-resource: ${subAction}` },
      { status: 404 }
    )
  } catch (error) {
    return errorResponse(error)
  }
}

async function sendMessage(req: Request, sessionId: string): Promise<Response> {
  const session = await sessionService.getSession(sessionId)
  if (!session) {
    throw ApiError.notFound(`Session not found: ${sessionId}`)
  }

  let body: { content?: string }
  try {
    body = (await req.json()) as { content?: string }
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }

  if (!body.content || typeof body.content !== 'string') {
    throw ApiError.badRequest('content (string) is required in request body')
  }

  const messageId = crypto.randomUUID()

  sessionStates.set(sessionId, 'thinking')

  return Response.json(
    { messageId, status: 'queued' as const },
    { status: 202 }
  )
}

function getChatStatus(sessionId: string): Response {
  const state = sessionStates.get(sessionId) || 'idle'
  return Response.json({ state })
}

function stopChat(sessionId: string): Response {
  sessionStates.set(sessionId, 'idle')
  return Response.json({ ok: true })
}

export function setSessionChatState(
  sessionId: string,
  state: 'idle' | 'thinking' | 'compacting' | 'tool_executing'
): void {
  sessionStates.set(sessionId, state)
}

export function getSessionChatState(
  sessionId: string
): 'idle' | 'thinking' | 'compacting' | 'tool_executing' {
  return sessionStates.get(sessionId) || 'idle'
}
