import { openaiResponsesToAnthropic } from '../transform/openaiResponsesToAnthropic.js'
import { upstreamErrorMessage } from './openaiResponsesStreamToAnthropic.js'
import { parseSseJson, SseDecoder, type SseMessage } from './sse.js'
import type {
  AnthropicResponse,
  OpenAIResponsesResponse,
} from '../transform/types.js'

type StreamFallbackState = {
  id: string
  createdAt: number
  status: string
  textByKey: Map<string, string>
  usage: OpenAIResponsesResponse['usage']
}

export class OpenAIResponsesStreamError extends Error {}

export async function openaiResponsesStreamToAnthropicResponse(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): Promise<AnthropicResponse> {
  const sse = new SseDecoder()
  const reader = upstream.getReader()
  let completedResponse: OpenAIResponsesResponse | null = null
  let upstreamError: string | null = null

  const fallback: StreamFallbackState = {
    id: `resp_${Date.now()}`,
    createdAt: Math.floor(Date.now() / 1000),
    status: 'completed',
    textByKey: new Map(),
    usage: undefined,
  }

  const handle = (messages: SseMessage[]) => {
    for (const message of messages) {
      if (message.type !== 'event') continue
      const event = message.event
      const parsed = parseSseJson(message.data.trim())
      if (!parsed || typeof parsed !== 'object') continue
      const data = parsed as Record<string, unknown>
      if (event === 'response.completed' || event === 'response.incomplete') {
        if (isOpenAIResponsesResponse(data.response)) completedResponse = data.response
      } else if (event === 'response.failed' || event === 'error') {
        upstreamError = upstreamErrorMessage(data)
      } else {
        updateFallbackState(event, data, fallback)
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    handle(sse.push(value))
  }
  handle(sse.flush())

  if (!completedResponse && upstreamError !== null) {
    throw new OpenAIResponsesStreamError(upstreamError)
  }

  return openaiResponsesToAnthropic(
    completedResponse ?? buildFallbackResponse(fallback, model),
    model,
  )
}

function updateFallbackState(
  event: string,
  data: Record<string, unknown>,
  fallback: StreamFallbackState,
): void {
  if (event === 'response.created') {
    if (typeof data.id === 'string') fallback.id = data.id
    if (typeof data.created_at === 'number') fallback.createdAt = data.created_at
    if (typeof data.status === 'string') fallback.status = data.status
    return
  }

  if (event === 'response.output_text.delta') {
    const key = getTextKey(data)
    const delta = typeof data.delta === 'string' ? data.delta : ''
    fallback.textByKey.set(key, (fallback.textByKey.get(key) ?? '') + delta)
    return
  }

  if (event === 'response.output_text.done') {
    const text = typeof data.text === 'string' ? data.text : null
    if (text !== null) fallback.textByKey.set(getTextKey(data), text)
    return
  }

  if (event === 'response.refusal.delta') {
    const key = getTextKey(data)
    const delta = typeof data.delta === 'string' ? data.delta : ''
    fallback.textByKey.set(key, (fallback.textByKey.get(key) ?? '') + delta)
  }
}

function buildFallbackResponse(
  fallback: StreamFallbackState,
  model: string,
): OpenAIResponsesResponse {
  const text = [...fallback.textByKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value)
    .join('')

  return {
    id: fallback.id,
    object: 'response',
    created_at: fallback.createdAt,
    model,
    status: fallback.status,
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text }],
    }],
    usage: fallback.usage,
  }
}

function getTextKey(data: Record<string, unknown>): string {
  const outputIndex = typeof data.output_index === 'number' ? data.output_index : 0
  const contentIndex = typeof data.content_index === 'number' ? data.content_index : 0
  return `${outputIndex}:${contentIndex}`
}

function isOpenAIResponsesResponse(
  value: unknown,
): value is OpenAIResponsesResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as { output?: unknown }).output)
  )
}
