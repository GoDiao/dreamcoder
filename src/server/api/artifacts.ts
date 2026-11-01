import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { readBody, requireString } from './requestBody.js'
import { artifactService } from '../services/artifactService.js'
import { artifactThumbnailService } from '../services/artifactThumbnailService.js'
import { conversationService } from '../services/conversationService.js'
import { sessionService } from '../services/sessionService.js'

async function putThumbnail(req: Request): Promise<Response> {
  const body = await readBody(req)
  const mtimeMs = body.mtimeMs
  if (typeof mtimeMs !== 'number') throw ApiError.badRequest('mtimeMs must be a number')
  await artifactThumbnailService.save(requireString(body, 'id'), mtimeMs, Buffer.from(requireString(body, 'data'), 'base64'))
  return Response.json({ ok: true })
}

function requireFiniteNumber(body: Record<string, unknown>, field: string, positive: boolean): number {
  const value = body[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw ApiError.badRequest(`${field} must be ${positive ? 'a positive' : 'a finite'} number`)
  }
  return value
}

async function patchBoard(req: Request): Promise<Response> {
  const body = await readBody(req)
  return Response.json(
    await artifactService.updateBoard(requireString(body, 'dir'), requireString(body, 'name'), requireString(body, 'boardId'), {
      x: requireFiniteNumber(body, 'x', false),
      y: requireFiniteNumber(body, 'y', false),
      width: requireFiniteNumber(body, 'width', true),
      height: requireFiniteNumber(body, 'height', true),
    }),
  )
}

async function handleArtifactsPost(req: Request, segments: string[]): Promise<Response> {
  const body = await readBody(req)
  switch (segments[2]) {
    case 'opened':
      await artifactService.markOpened(requireString(body, 'id'))
      return Response.json({ ok: true })
    case 'copy': {
      const sessionId = requireString(body, 'sessionId')
      const workDir = conversationService.getSessionWorkDir(sessionId) || await sessionService.getSessionWorkDir(sessionId)
      if (!workDir) throw ApiError.notFound(`Session not found: ${sessionId}`)
      return Response.json(await artifactService.copyIntoWorkDir(requireString(body, 'id'), workDir))
    }
    default:
      throw ApiError.notFound(`Unknown artifacts resource: ${segments[2] ?? ''}`)
  }
}

export async function handleArtifactsApi(req: Request, url: URL, segments: string[]): Promise<Response> {
  try {
    if (req.method === 'POST') return await handleArtifactsPost(req, segments)
    if (req.method === 'PUT' && segments[2] === 'thumbnail') return await putThumbnail(req)
    if (req.method === 'PATCH' && segments[2] === 'boards') return await patchBoard(req)
    if (req.method !== 'GET') {
      throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
    }
    switch (segments[2]) {
      case undefined:
        return Response.json({ artifacts: await artifactService.listAll() })
      case 'thumbnail': {
        const id = url.searchParams.get('id')
        if (!id) throw ApiError.badRequest('id is required')
        const image = await artifactThumbnailService.read(id)
        if (!image) throw ApiError.notFound('No thumbnail for this artifact')
        return new Response(image, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' } })
      }
      case 'open': {
        const id = url.searchParams.get('id')
        if (id) return Response.json(await artifactService.resolveOpenById(id))
        const dir = url.searchParams.get('dir')
        const name = url.searchParams.get('name')
        if (!dir || !name) throw ApiError.badRequest('Pass id, or dir and name')
        return Response.json(await artifactService.resolveOpen(dir, name, url.searchParams.get('board') ?? undefined))
      }
      default:
        throw ApiError.notFound(`Unknown artifacts resource: ${segments[2]}`)
    }
  } catch (error) {
    return errorResponse(error)
  }
}
