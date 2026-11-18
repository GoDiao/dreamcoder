import { stringifyOpenAIToolArguments } from '../transform/toolArguments.js'
import { mapResponsesUsage } from '../transform/openaiResponsesToAnthropic.js'
import type { OpenAIResponsesUsage } from '../transform/types.js'
import { parseSseJson, SseDecoder, type SseMessage } from './sse.js'

type StreamState = {
  nextContentIndex: number
  indexByKey: Map<string, number>
  toolIndexByItemId: Map<string, number>
  reasoningIndexByItemId: Map<string, number>
  model: string
  messageStarted: boolean
  messageStopped: boolean
}

export function upstreamErrorMessage(data: Record<string, unknown>): string {
  const response = data.response as Record<string, unknown> | undefined
  const error = (response?.error ?? data.error ?? data) as Record<string, unknown> | undefined
  return typeof error?.message === 'string' && error.message
    ? error.message
    : 'Upstream Responses stream failed'
}

function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function openaiResponsesStreamToAnthropic(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const sse = new SseDecoder()

  const state: StreamState = {
    nextContentIndex: 0,
    indexByKey: new Map(),
    toolIndexByItemId: new Map(),
    reasoningIndexByItemId: new Map(),
    model,
    messageStarted: false,
    messageStopped: false,
  }

  const reader = upstream.getReader()
  let cancelled = false

  return new ReadableStream({
    async start(controller) {
      const handle = (messages: SseMessage[]) => {
        for (const message of messages) {
          if (message.type === 'event') handleEvent(message.event, message.data.trim(), state, controller, encoder)
          else if (!state.messageStopped) controller.enqueue(encoder.encode(formatSse('ping', { type: 'ping' })))
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          handle(sse.push(value))
        }
        handle(sse.flush())

        const body = sse.unframedBody()
        if (body) emitUnframedError(body, controller, encoder)
      } catch (err) {
        if (!cancelled) controller.error(err)
        return
      }
      if (!cancelled) controller.close()
    },
    cancel(reason) {
      cancelled = true
      return reader.cancel(reason)
    },
  })
}

function handleEvent(
  event: string,
  data: string,
  state: StreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
): void {
  if (data === '[DONE]') {
    if (!state.messageStopped) {
      state.messageStopped = true
      if (!state.messageStarted) {
        emitMessageStart(state, controller, encoder)
      }
      controller.enqueue(encoder.encode(formatSse('message_stop', { type: 'message_stop' })))
    }
    return
  }

  const parsed = parseSseJson(data)
  if (state.messageStopped || !parsed || typeof parsed !== 'object') return
  const record = parsed as Record<string, unknown>
  processEvent(event || String(record.type ?? ''), record, state, controller, encoder)
}

function emitUnframedError(
  body: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
): void {
  const parsed = parseSseJson(body) as Record<string, unknown> | undefined
  if (!parsed || typeof parsed !== 'object' || !parsed.error) return
  controller.enqueue(encoder.encode(formatSse('error', {
    type: 'error',
    error: { type: 'api_error', message: upstreamErrorMessage(parsed) },
  })))
}

function emitMessageStart(
  state: StreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
): void {
  state.messageStarted = true
  controller.enqueue(encoder.encode(formatSse('message_start', {
    type: 'message_start',
    message: {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model: state.model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })))
}

function processEvent(
  event: string,
  data: Record<string, unknown>,
  state: StreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
): void {
  switch (event) {
    case 'response.created': {
      emitMessageStart(state, controller, encoder)
      break
    }

    case 'response.output_item.added': {
      if (!state.messageStarted) emitMessageStart(state, controller, encoder)
      const item = data.item as Record<string, unknown> | undefined
      if (!item) break

      if (item.type === 'function_call') {
        const index = state.nextContentIndex++
        const callId = (item.call_id as string) || (item.id as string) || ''
        const name = (item.name as string) || ''
        state.toolIndexByItemId.set(item.id as string || callId, index)

        controller.enqueue(encoder.encode(formatSse('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: {
            type: 'tool_use',
            id: callId,
            name,
            input: {},
          },
        })))
      }
      break
    }

    case 'response.content_part.added': {
      if (!state.messageStarted) emitMessageStart(state, controller, encoder)
      const part = data.part as Record<string, unknown> | undefined
      if (part?.type !== 'output_text' && part?.type !== 'refusal') break

      const contentIndex = (data.content_index as number) ?? 0
      const outputIndex = (data.output_index as number) ?? 0
      const key = `${outputIndex}:${contentIndex}`
      const index = state.nextContentIndex++
      state.indexByKey.set(key, index)

      controller.enqueue(encoder.encode(formatSse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      })))
      break
    }

    case 'response.output_text.delta': {
      const contentIndex = (data.content_index as number) ?? 0
      const outputIndex = (data.output_index as number) ?? 0
      const key = `${outputIndex}:${contentIndex}`
      const index = state.indexByKey.get(key)
      if (index === undefined) break

      const delta = (data.delta as string) || ''
      controller.enqueue(encoder.encode(formatSse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: delta },
      })))
      break
    }

    case 'response.refusal.delta': {
      const contentIndex = (data.content_index as number) ?? 0
      const outputIndex = (data.output_index as number) ?? 0
      const key = `${outputIndex}:${contentIndex}`
      const index = state.indexByKey.get(key)
      if (index === undefined) break

      const delta = (data.delta as string) || ''
      controller.enqueue(encoder.encode(formatSse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: delta },
      })))
      break
    }

    case 'response.function_call_arguments.delta': {
      const itemId = (data.item_id as string) || ''
      const index = state.toolIndexByItemId.get(itemId)
      if (index === undefined) break

      const delta = stringifyOpenAIToolArguments(data.delta)
      controller.enqueue(encoder.encode(formatSse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: delta },
      })))
      break
    }

    case 'response.output_text.done':
    case 'response.refusal.done': {
      const contentIndex = (data.content_index as number) ?? 0
      const outputIndex = (data.output_index as number) ?? 0
      const key = `${outputIndex}:${contentIndex}`
      const index = state.indexByKey.get(key)
      if (index === undefined) break

      controller.enqueue(encoder.encode(formatSse('content_block_stop', {
        type: 'content_block_stop',
        index,
      })))
      break
    }

    case 'response.function_call_arguments.done': {
      const itemId = (data.item_id as string) || ''
      const index = state.toolIndexByItemId.get(itemId)
      if (index === undefined) break

      controller.enqueue(encoder.encode(formatSse('content_block_stop', {
        type: 'content_block_stop',
        index,
      })))
      break
    }

    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta': {
      const itemId = (data.item_id as string) || ''
      let index = state.reasoningIndexByItemId.get(itemId)
      if (index === undefined) {
        index = state.nextContentIndex++
        state.reasoningIndexByItemId.set(itemId, index)
        if (!state.messageStarted) emitMessageStart(state, controller, encoder)
        controller.enqueue(encoder.encode(formatSse('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'thinking', thinking: '' },
        })))
      }

      const delta = (data.delta as string) || ''
      controller.enqueue(encoder.encode(formatSse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: delta },
      })))
      break
    }

    case 'response.reasoning_summary_text.done':
    case 'response.reasoning_text.done':
    case 'response.reasoning_summary_part.done': {
      const itemId = (data.item_id as string) || ''
      const index = state.reasoningIndexByItemId.get(itemId)
      if (index === undefined) break
      state.reasoningIndexByItemId.delete(itemId)

      controller.enqueue(encoder.encode(formatSse('content_block_stop', {
        type: 'content_block_stop',
        index,
      })))
      break
    }

    case 'response.failed':
    case 'error': {
      const message = upstreamErrorMessage(data)
      state.messageStopped = true
      controller.enqueue(encoder.encode(formatSse('error', {
        type: 'error',
        error: { type: 'api_error', message },
      })))
      break
    }

    case 'response.incomplete':
    case 'response.completed': {
      const response = data.response as Record<string, unknown> | undefined
      const status = (response?.status as string) || 'completed'
      const usage = response?.usage as OpenAIResponsesUsage | undefined
      const hasToolUse = state.toolIndexByItemId.size > 0

      const stopReason = status === 'completed'
        ? (hasToolUse ? 'tool_use' : 'end_turn')
        : status === 'incomplete' ? 'max_tokens' : 'end_turn'

      for (const [, index] of state.reasoningIndexByItemId) {
        controller.enqueue(encoder.encode(formatSse('content_block_stop', {
          type: 'content_block_stop',
          index,
        })))
      }
      state.reasoningIndexByItemId.clear()

      controller.enqueue(encoder.encode(formatSse('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: mapResponsesUsage(usage),
      })))
      if (!state.messageStopped) {
        state.messageStopped = true
        controller.enqueue(encoder.encode(formatSse('message_stop', { type: 'message_stop' })))
      }
      break
    }
  }
}
