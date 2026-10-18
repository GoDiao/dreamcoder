import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { claudeCodeImportService } from '../services/claudeCodeImportService.js'

/**
 * GET  /api/claude-code-import        — whether to offer the import, and its progress
 * POST /api/claude-code-import/start  — start the import
 * POST /api/claude-code-import/skip   — start empty; the import is not offered again
 */
export async function handleClaudeCodeImportApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  void url

  try {
    const action = segments[2]

    if (action === undefined) {
      if (req.method !== 'GET') throw methodNotAllowed(req.method)
      return Response.json(await claudeCodeImportService.getStatus())
    }

    if (action === 'start') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      return Response.json({ job: claudeCodeImportService.start() })
    }

    if (action === 'skip') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      await claudeCodeImportService.skip()
      return Response.json({ ok: true })
    }

    throw ApiError.notFound(`Unknown Claude Code import endpoint: ${action}`)
  } catch (error) {
    return errorResponse(error)
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
