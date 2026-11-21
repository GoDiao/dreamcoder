import { isClaudeModelName } from '../../utils/model/claudeModelName.js'
import { ProviderService } from '../services/providerService.js'
import { sendToUpstream } from '../upstream/client.js'
import { anthropicErrorResponse } from '../upstream/upstreamError.js'
import { ensureClaudeCodeAttribution } from './claudeCodeAttribution.js'
import type { AnthropicRequest } from './transform/types.js'

const providerService = new ProviderService()

export type ProxyServer = {
  timeout(request: Request, seconds: number): void
}

export async function handleProxyRequest(req: Request, url: URL, server: ProxyServer): Promise<Response> {
  server.timeout(req, 0)
  const providerMatch = url.pathname.match(/^\/proxy\/providers\/([^/]+)\/v1\/messages$/)
  const providerId = providerMatch ? decodeURIComponent(providerMatch[1]!) : undefined
  const isActiveProxyPath = url.pathname === '/proxy/v1/messages'

  if (req.method !== 'POST' || (!isActiveProxyPath && !providerMatch)) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'not_found_error',
          message: 'Proxy only handles POST /proxy/v1/messages and POST /proxy/providers/:providerId/v1/messages',
        },
      },
      { status: 404 },
    )
  }

  const upstream = await providerService.getProviderForProxy(providerId)
  if (!upstream) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: providerId
            ? `Provider "${providerId}" is not configured for proxy`
            : 'No active provider configured for proxy',
        },
      },
      { status: 400 },
    )
  }

  if (upstream.target.apiFormat === 'anthropic') {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: providerId
            ? `Provider "${providerId}" uses anthropic format — proxy not needed`
            : 'Active provider uses anthropic format — proxy not needed',
        },
      },
      { status: 400 },
    )
  }

  let body: AnthropicRequest
  try {
    body = (await req.json()) as AnthropicRequest
  } catch {
    return Response.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON in request body' } },
      { status: 400 },
    )
  }

  const upstreamBody = isClaudeModelName(body.model) ? ensureClaudeCodeAttribution(body) : body
  const result = await sendToUpstream(upstream, upstreamBody, {
    signal: req.signal,
    sessionId: req.headers.get('x-claude-code-session-id') ?? undefined,
  })

  if (!result.ok) {
    return anthropicErrorResponse(
      { status: result.httpStatus ?? 502, type: result.errorType ?? 'api_error', message: result.error },
      result.headers,
    )
  }

  if ('stream' in result) {
    return new Response(result.stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  return Response.json(result.message)
}
