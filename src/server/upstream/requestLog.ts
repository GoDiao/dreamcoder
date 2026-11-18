import { diagnosticsService } from '../services/diagnosticsService.js'
import type { ApiFormat } from '../types/provider.js'

export type UpstreamRequestInfo = {
  providerId?: string
  model: string
  baseUrl: string
  apiFormat: ApiFormat
  stream: boolean
  startedAt: number
}

export type UpstreamOutcome = {
  outcome: 'completed' | 'incomplete' | 'error' | 'idle_timeout' | 'client_aborted' | 'client_disconnected'
  error?: string
}

export type UpstreamResponseInfo = {
  status?: number
  requestId?: string
  headersMs?: number
}

export function recordUpstreamRequest(
  info: UpstreamRequestInfo,
  response: UpstreamResponseInfo,
  { outcome, error }: UpstreamOutcome,
): void {
  const failed = outcome === 'error' || outcome === 'incomplete' || outcome === 'idle_timeout'
  void diagnosticsService.recordEvent({
    type: 'upstream_request',
    severity: failed ? 'warn' : 'info',
    summary: `${info.apiFormat} ${info.model}: ${outcome}${response.status ? ` (HTTP ${response.status})` : ''}`,
    details: {
      providerId: info.providerId,
      model: info.model,
      host: hostOf(info.baseUrl),
      apiFormat: info.apiFormat,
      stream: info.stream,
      status: response.status,
      requestId: response.requestId,
      headersMs: response.headersMs,
      durationMs: Date.now() - info.startedAt,
      outcome,
      error,
    },
  })
}

function hostOf(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).host
  } catch {
    return undefined
  }
}
