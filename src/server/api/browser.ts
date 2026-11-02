import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { getBrowserRuntime } from '../browserHost/runtime.js'
import { readBody, requireString } from './requestBody.js'

async function readIds(req: Request): Promise<{ sessionId: string; tabId: string }> {
  const body = await readBody(req)
  return { sessionId: requireString(body, 'sessionId'), tabId: requireString(body, 'tabId') }
}

export async function handleBrowserApi(req: Request, _url: URL, segments: string[]): Promise<Response> {
  try {
    if (req.method !== 'POST') throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
    if (segments[2] !== 'emulation' || (segments[3] !== 'suspend' && segments[3] !== 'resume')) {
      throw ApiError.notFound(`Unknown browser resource: ${segments.slice(2).join('/')}`)
    }
    const { sessionId, tabId } = await readIds(req)
    const { service } = getBrowserRuntime()
    const changed = segments[3] === 'suspend'
      ? await service.suspendEmulation(sessionId, tabId)
      : await service.resumeEmulation(sessionId, tabId)
    return Response.json({ changed })
  } catch (error) {
    return errorResponse(error)
  }
}
