import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { SettingsService } from '../services/settingsService.js'
import {
  currentTerminalPlatform,
  defaultShell,
  normalizeBashPath,
  readDesktopTerminalConfig,
} from '../services/terminalService.js'

export async function handleTerminalApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]

    if (action === 'default-shell') {
      if (req.method !== 'GET') {
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      }
      const config = readDesktopTerminalConfig(await new SettingsService().getUserSettings())
      const platform = currentTerminalPlatform()
      return Response.json({ shell: defaultShell(platform, config.bashPath), platform })
    }

    if (action === 'validate-bash-path') {
      if (req.method !== 'POST') {
        throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
      }
      const body = await parseJsonBody(req)
      if (body.path !== null && body.path !== undefined && typeof body.path !== 'string') {
        throw ApiError.badRequest('"path" must be a string or null')
      }
      try {
        return Response.json({ path: normalizeBashPath(body.path ?? null) })
      } catch (error) {
        throw ApiError.badRequest(error instanceof Error ? error.message : String(error))
      }
    }

    throw ApiError.notFound(`Unknown terminal endpoint: ${action ?? ''}`)
  } catch (error) {
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as Record<string, unknown> : {}
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}
