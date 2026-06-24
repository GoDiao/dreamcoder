import { openaiResponsesToAnthropic } from '../transform/openaiResponsesToAnthropic.js'
import type {
  AnthropicResponse,
  OpenAIResponsesResponse,
} from '../transform/types.js'

type StreamFallbackState = {
  id: string
  createdAt: number
  model: string
  status: string
  textByKey: Map<string, string>
  usage: OpenAIResponsesResponse['usage']
}

/**
 * Collect a streamed OpenAI Responses API response into one Anthropic message.
 * ChatGPT Codex requires upstream stream=true, but some Anthropic SDK callers
 * still expect a non-streaming JSON response.
 */
export async function openaiResponsesStreamToAnthropicResponse(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): Promise<AnthropicResponse> {
  const decoder = new TextDecoder()
  const reader = upstream.getReader()
  let buffer = ''
  let currentEvent = ''
  let completedResponse: OpenAIResponsesResponse | null = null

  const fallback: StreamFallbackState = {
    id: `resp_${Date.now()}`,
    createdAt: Math.floor(Date.now() / 1000),
    model,
    status: 'completed',
    textByKey: new Map(),
    usage: undefined,
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('event: ')) {
        currentEvent = trimmed.slice(7).trim()
        continue
      }

      if (!trimmed.startsWith('data: ')) {
        if (trimmed === '') currentEvent = ''
        continue
      }

      const jsonStr = trimmed.slice(6)
      if (jsonStr === '[DONE]') {
        currentEvent = ''
        continue
      }

      let data: Record<string, unknown>
      try {
        data = JSON.parse(jsonStr) as Record<string, unknown>
      } catch {
        currentEvent = ''
        continue
      }

      if (currentEvent === 'response.completed') {
        const response = data.response
        if (isOpenAIResponsesResponse(response)) {
          completedResponse = response
        }
      } else {
        updateFallbackState(currentEvent, data, fallback)
      }
      currentEvent = ''
    }
  }

  return openaiResponsesToAnthropic(
    completedResponse ?? buildFallbackResponse(fallback),
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
    if (typeof data.model === 'string') fallback.model = data.model
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
): OpenAIResponsesResponse {
  const text = [...fallback.textByKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value)
    .join('')

  return {
    id: fallback.id,
    object: 'response',
    created_at: fallback.createdAt,
    model: fallback.model,
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
