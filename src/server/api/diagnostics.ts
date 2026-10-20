import { diagnosticsService } from '../services/diagnosticsService.js'
import { buildProblemReport } from '../services/problemReport.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

export async function handleDiagnosticsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]

    if (!action && req.method === 'DELETE') {
      await diagnosticsService.clear()
      return Response.json({ ok: true })
    }

    if (action === 'status' && req.method === 'GET') {
      return Response.json(await diagnosticsService.getStatus())
    }

    if (action === 'events' && req.method === 'GET') {
      const limit = Number.parseInt(url.searchParams.get('limit') || '100', 10)
      const events = await diagnosticsService.readRecentEvents(Number.isFinite(limit) ? limit : 100)
      return Response.json({ events })
    }

    if (action === 'events' && req.method === 'POST') {
      const body = await parseJsonBody(req)
      const type = typeof body.type === 'string' && body.type.trim()
        ? body.type.trim().slice(0, 128)
        : 'client_diagnostic_event'
      const severity = isDiagnosticSeverity(body.severity) ? body.severity : 'error'
      const summary = typeof body.summary === 'string' && body.summary.trim()
        ? body.summary
        : type
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
      await diagnosticsService.recordEvent({
        type,
        severity,
        summary,
        sessionId,
        details: body.details,
      })
      return Response.json({ ok: true })
    }

    if (action === 'report' && req.method === 'GET') {
      return Response.json(await buildProblemReport())
    }

    if (action === 'export' && req.method === 'POST') {
      return Response.json({ bundle: await diagnosticsService.exportBundle() })
    }

    if (action === 'reveal-export' && req.method === 'POST') {
      const body = await parseJsonBody(req)
      const fileName = typeof body.fileName === 'string' ? body.fileName : ''
      try {
        await diagnosticsService.revealExport(fileName)
      } catch {
        throw ApiError.badRequest('Unknown export file')
      }
      return Response.json({ ok: true })
    }

    if (action === 'open-log-dir' && req.method === 'POST') {
      await diagnosticsService.openLogDir()
      return Response.json({ ok: true })
    }

    throw new ApiError(404, `Unknown diagnostics endpoint: ${action ?? '(root)'}`, 'NOT_FOUND')
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

function isDiagnosticSeverity(value: unknown): value is 'debug' | 'info' | 'warn' | 'error' {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
}
