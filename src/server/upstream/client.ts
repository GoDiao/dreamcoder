import { signClaudeCodeCCHInTransformedString } from '../../utils/claudeCodeCch.js'
import { getProxyFetchOptions } from '../../utils/proxy.js'
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js'
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js'
import { openaiChatStreamToAnthropic } from '../proxy/streaming/openaiChatStreamToAnthropic.js'
import { openaiResponsesStreamToAnthropic } from '../proxy/streaming/openaiResponsesStreamToAnthropic.js'
import type {
  AnthropicRequest,
  AnthropicResponse,
  OpenAIChatResponse,
  OpenAIResponsesResponse,
} from '../proxy/transform/types.js'
import { getManualNetworkProxyUrl, loadNetworkSettings } from '../services/networkSettings.js'
import {
  getPresetAuthStrategy,
  getPresetDefaultEnv,
  resolveProviderApiKey,
  stripContextSuffix,
} from '../services/providerRuntimeEnv.js'
import type { ApiFormat, ProviderAuthStrategy, ProviderModel, SavedProvider } from '../types/provider.js'
import { normalizeUpstreamBaseUrl } from './baseUrl.js'

export type UpstreamTarget = {
  baseUrl: string
  apiKey: string
  apiFormat: ApiFormat
  authStrategy: ProviderAuthStrategy
}

export type UpstreamResult =
  | { ok: true; httpStatus: number; message: AnthropicResponse }
  | { ok: true; httpStatus: number; stream: ReadableStream<Uint8Array> }
  | { ok: false; httpStatus?: number; error: string }

export type UpstreamModelsResult =
  | { ok: true; httpStatus: number; models: ProviderModel[] }
  | { ok: false; httpStatus?: number; error: string }

type UpstreamRequest = {
  url: string
  headers: Record<string, string>
  body: string
}

export function resolveUpstreamTarget(provider: SavedProvider): UpstreamTarget {
  return {
    baseUrl: provider.baseUrl,
    apiKey: resolveProviderApiKey(provider, getPresetDefaultEnv(provider.presetId)),
    apiFormat: provider.apiFormat ?? 'anthropic',
    authStrategy: provider.authStrategy ?? getPresetAuthStrategy(provider.presetId),
  }
}

export async function sendToUpstream(
  target: UpstreamTarget,
  request: AnthropicRequest,
  options?: { timeoutMs?: number },
): Promise<UpstreamResult> {
  const networkSettings = await loadNetworkSettings()
  const timeoutMs = options?.timeoutMs ?? networkSettings.aiRequestTimeoutMs
  const isStream = request.stream === true
  const anthropicRequest = { ...request, model: stripContextSuffix(request.model) }
  const upstreamRequest = buildUpstreamRequest(target, anthropicRequest)

  let response: Response
  try {
    response = await fetchWithTimeout(upstreamRequest.url, {
      method: 'POST',
      headers: upstreamRequest.headers,
      body: upstreamRequest.body,
      ...getProxyFetchOptions({ proxyUrl: getManualNetworkProxyUrl(networkSettings) }),
    }, timeoutMs, isStream)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { ok: false, error: `Request timed out (${Math.round(timeoutMs / 1000)}s)` }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    return {
      ok: false,
      httpStatus: response.status,
      error: `Upstream returned HTTP ${response.status}: ${errText.slice(0, 500)}`,
    }
  }

  if (isStream) {
    if (!response.body) {
      return { ok: false, httpStatus: 502, error: 'Upstream returned no body for stream' }
    }
    return {
      ok: true,
      httpStatus: response.status,
      stream: toAnthropicStream(target.apiFormat, response.body, anthropicRequest.model),
    }
  }

  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  const invalid = validateResponseBody(body, target.apiFormat)
  if (invalid) {
    return { ok: false, httpStatus: 502, error: invalid }
  }
  try {
    return {
      ok: true,
      httpStatus: response.status,
      message: toAnthropicMessage(target.apiFormat, body!, anthropicRequest.model),
    }
  } catch (err) {
    return { ok: false, httpStatus: 502, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function fetchUpstreamModels(target: UpstreamTarget): Promise<UpstreamModelsResult> {
  const networkSettings = await loadNetworkSettings()
  const base = normalizeUpstreamBaseUrl(target.baseUrl)
  const headers = target.apiFormat === 'anthropic'
    ? {
        'anthropic-version': '2023-06-01',
        ...buildAnthropicAuthHeaders(target.apiKey, target.authStrategy),
      }
    : { Authorization: `Bearer ${target.apiKey}` }

  const seen = new Set<string>()
  const models: ProviderModel[] = []
  const maxPages = target.apiFormat === 'anthropic' ? 10 : 1
  let afterId = ''

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${base}/v1/models`)
    if (target.apiFormat === 'anthropic') {
      url.searchParams.set('limit', '1000')
      if (afterId) url.searchParams.set('after_id', afterId)
    }

    let response: Response
    try {
      response = await fetchWithTimeout(url.toString(), {
        method: 'GET',
        headers,
        ...getProxyFetchOptions({ proxyUrl: getManualNetworkProxyUrl(networkSettings) }),
      }, networkSettings.aiRequestTimeoutMs, false)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { ok: false, error: `Request timed out (${Math.round(networkSettings.aiRequestTimeoutMs / 1000)}s)` }
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return {
        ok: false,
        httpStatus: response.status,
        error: `Upstream returned HTTP ${response.status}: ${errText.slice(0, 500)}`,
      }
    }

    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    const data = body && Array.isArray(body.data) ? body.data : null
    if (!data) {
      return { ok: false, httpStatus: 502, error: 'Upstream model response is missing a data array' }
    }

    for (const entry of data) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id.trim() : ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      const rawName = typeof record.display_name === 'string'
        ? record.display_name
        : typeof record.name === 'string'
          ? record.name
          : ''
      const name = rawName.trim()
      models.push({ id, ...(name && name !== id ? { name } : {}) })
    }

    if (target.apiFormat !== 'anthropic' || body?.has_more !== true) {
      return { ok: true, httpStatus: response.status, models }
    }

    const lastId = typeof body.last_id === 'string' ? body.last_id.trim() : ''
    if (!lastId || lastId === afterId) {
      return { ok: false, httpStatus: 502, error: 'Upstream model pagination is missing a usable last_id' }
    }
    afterId = lastId
  }

  return { ok: false, httpStatus: 502, error: `Upstream model pagination exceeded ${maxPages} pages` }
}

function buildUpstreamRequest(target: UpstreamTarget, request: AnthropicRequest): UpstreamRequest {
  const base = normalizeUpstreamBaseUrl(target.baseUrl)

  if (target.apiFormat === 'openai_chat') {
    const compat = shouldUseDeepSeekReasoningCompat(base)
    const transformed = anthropicToOpenaiChat(request, {
      roundTripReasoningContent: compat,
      passThinkingToggle: compat,
    })
    return {
      url: `${base}/v1/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
      body: signClaudeCodeCCHInTransformedString(JSON.stringify(transformed)),
    }
  }

  if (target.apiFormat === 'openai_responses') {
    return {
      url: `${base}/v1/responses`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
      body: signClaudeCodeCCHInTransformedString(JSON.stringify(anthropicToOpenaiResponses(request))),
    }
  }

  return {
    url: `${base}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...buildAnthropicAuthHeaders(target.apiKey, target.authStrategy),
    },
    body: JSON.stringify(request),
  }
}

function buildAnthropicAuthHeaders(apiKey: string, authStrategy: ProviderAuthStrategy): Record<string, string> {
  switch (authStrategy) {
    case 'api_key':
      return { 'x-api-key': apiKey }
    case 'auth_token':
    case 'auth_token_empty_api_key':
      return { Authorization: `Bearer ${apiKey}` }
    case 'dual_same_token':
      return { 'x-api-key': apiKey, Authorization: `Bearer ${apiKey}` }
    case 'dual_dummy':
      return { 'x-api-key': 'dummy', Authorization: 'Bearer dummy' }
  }
}

function shouldUseDeepSeekReasoningCompat(baseUrl: string): boolean {
  return (
    /(^|[./-])deepseek([./-]|$)/i.test(baseUrl) ||
    /(^|[./-])opencode\.ai([:/]|$)/i.test(baseUrl)
  )
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  isStream: boolean,
): Promise<Response> {
  if (!isStream) {
    return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation timed out.', 'TimeoutError'))
  }, timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function toAnthropicStream(
  format: ApiFormat,
  body: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  if (format === 'openai_chat') return openaiChatStreamToAnthropic(body, model)
  if (format === 'openai_responses') return openaiResponsesStreamToAnthropic(body, model)
  return body
}

function toAnthropicMessage(
  format: ApiFormat,
  body: Record<string, unknown>,
  model: string,
): AnthropicResponse {
  if (format === 'openai_chat') return openaiChatToAnthropic(body as OpenAIChatResponse, model)
  if (format === 'openai_responses') return openaiResponsesToAnthropic(body as OpenAIResponsesResponse, model)
  return body as AnthropicResponse
}

function validateResponseBody(body: Record<string, unknown> | null, format: ApiFormat): string | null {
  if (!body) return 'Empty response — not a valid API endpoint'
  if (body.error && typeof body.error === 'object') {
    return ((body.error as Record<string, unknown>).message as string) || 'Error in response body'
  }
  if (format === 'openai_chat') {
    return Array.isArray(body.choices) && body.choices.length > 0
      ? null
      : 'Response missing choices — not a valid Chat Completions endpoint'
  }
  if (format === 'openai_responses') {
    return Array.isArray(body.output)
      ? null
      : 'Response missing output — not a valid Responses API endpoint'
  }
  return body.type === 'message' && Array.isArray(body.content)
    ? null
    : 'Not a valid Anthropic Messages endpoint'
}
