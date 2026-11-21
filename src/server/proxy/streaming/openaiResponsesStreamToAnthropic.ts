import { stringifyOpenAIToolArguments } from '../transform/toolArguments.js'
import {
  mapResponsesStatus,
  mapResponsesUsage,
  responsesReasoningSignature,
  responsesReasoningText,
} from '../transform/openaiResponsesToAnthropic.js'
import type { OpenAIResponsesUsage } from '../transform/types.js'
import type { ResolvedModelRules } from '../../types/modelRules.js'
import {
  anthropicErrorBody,
  readProviderError,
  streamClosedEarlyError,
  toAnthropicError,
  type AnthropicError,
} from '../../upstream/upstreamError.js'
import { parseSseJson, SseDecoder, type SseMessage } from './sse.js'

type OpenBlock = { index: number; sent: boolean; closed: boolean }
type ReasoningBlock = OpenBlock & { partDone: boolean }

type StreamState = {
  nextContentIndex: number
  texts: Map<string, OpenBlock>
  tools: Map<string, OpenBlock>
  reasoning: Map<string, ReasoningBlock>
  rules: ResolvedModelRules
  model: string
  messageStarted: boolean
  messageStopped: boolean
  emit: (event: string, data: unknown) => void
}

function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function openaiResponsesStreamToAnthropic(
  upstream: ReadableStream<Uint8Array>,
  model: string,
  rules: ResolvedModelRules,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const sse = new SseDecoder()
  const reader = upstream.getReader()
  let cancelled = false

  return new ReadableStream({
    async start(controller) {
      const state: StreamState = {
        nextContentIndex: 0,
        texts: new Map(),
        tools: new Map(),
        reasoning: new Map(),
        rules,
        model,
        messageStarted: false,
        messageStopped: false,
        emit: (event, data) => controller.enqueue(encoder.encode(formatSse(event, data))),
      }
      const handle = (messages: SseMessage[]) => {
        for (const message of messages) {
          if (message.type === 'event') handleEvent(message.event, message.data.trim(), state)
          else if (!state.messageStopped) state.emit('ping', { type: 'ping' })
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          handle(sse.push(value))
        }
        handle(sse.flush())

        if (!state.messageStopped) {
          const unframed = sse.unframedBody()
          const body = unframed ? parseSseJson(unframed) as Record<string, unknown> | undefined : undefined
          emitError(state, body?.error
            ? errorFromEvent(body)
            : streamClosedEarlyError())
        }
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

function handleEvent(event: string, data: string, state: StreamState): void {
  if (state.messageStopped) return
  if (data === '[DONE]') {
    finishMessage(state, 'completed', undefined, undefined)
    return
  }

  const parsed = parseSseJson(data)
  if (!parsed || typeof parsed !== 'object') return
  const record = parsed as Record<string, unknown>
  processEvent(event || String(record.type ?? ''), record, state)
}

export function errorFromEvent(data: Record<string, unknown>): AnthropicError {
  const response = data.response as Record<string, unknown> | undefined
  const source = response?.error ? { error: response.error } : data.error || data.message ? data : undefined
  return toAnthropicError(undefined, readProviderError(source) ?? { message: 'Upstream Responses stream failed' })
}

function emitError(state: StreamState, error: AnthropicError): void {
  state.messageStopped = true
  state.emit('error', anthropicErrorBody(error))
}

function ensureMessageStart(state: StreamState): void {
  if (state.messageStarted) return
  state.messageStarted = true
  state.emit('message_start', {
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
  })
}

function openBlock(state: StreamState, contentBlock: Record<string, unknown>): OpenBlock {
  ensureMessageStart(state)
  const block = { index: state.nextContentIndex++, sent: false, closed: false }
  state.emit('content_block_start', { type: 'content_block_start', index: block.index, content_block: contentBlock })
  return block
}

function sendDelta(state: StreamState, block: OpenBlock, delta: Record<string, unknown>): void {
  block.sent = true
  state.emit('content_block_delta', { type: 'content_block_delta', index: block.index, delta })
}

function closeBlock(state: StreamState, block: OpenBlock | undefined): void {
  if (!block || block.closed) return
  block.closed = true
  state.emit('content_block_stop', { type: 'content_block_stop', index: block.index })
}

function textKey(data: Record<string, unknown>, contentIndex = data.content_index): string {
  return `${(data.output_index as number) ?? 0}:${(contentIndex as number) ?? 0}`
}

function closeReasoningBlocks(state: StreamState): void {
  for (const block of state.reasoning.values()) closeBlock(state, block)
}

function reasoningBlock(state: StreamState, itemId: string): ReasoningBlock {
  let block = state.reasoning.get(itemId)
  if (!block || block.closed) {
    block = { ...openBlock(state, { type: 'thinking', thinking: '' }), partDone: false }
    state.reasoning.set(itemId, block)
  }
  return block
}

function sendThinking(state: StreamState, block: ReasoningBlock, text: string): void {
  if (!text) return
  const separator = block.partDone && block.sent ? '\n\n' : ''
  block.partDone = false
  sendDelta(state, block, { type: 'thinking_delta', thinking: separator + text })
}

function completeReasoning(state: StreamState, item: Record<string, unknown>): void {
  const itemId = (item.id as string) || ''
  const existing = state.reasoning.get(itemId)
  if (existing?.closed) return
  const signature = responsesReasoningSignature(item, state.rules)
  const summary = responsesReasoningText(item)
  if (!existing && !signature && !summary) return
  const block = existing ?? reasoningBlock(state, itemId)
  if (!existing) sendThinking(state, block, summary)
  if (signature) sendDelta(state, block, { type: 'signature_delta', signature })
  closeBlock(state, block)
}

function textBlock(state: StreamState, key: string): OpenBlock {
  let block = state.texts.get(key)
  if (!block) {
    closeReasoningBlocks(state)
    block = openBlock(state, { type: 'text', text: '' })
    state.texts.set(key, block)
  }
  return block
}

function toolBlock(state: StreamState, item: Record<string, unknown>): OpenBlock {
  const itemId = (item.id as string) || (item.call_id as string) || ''
  let block = state.tools.get(itemId)
  if (!block) {
    closeReasoningBlocks(state)
    block = openBlock(state, {
      type: 'tool_use',
      id: (item.call_id as string) || itemId,
      name: (item.name as string) || '',
      input: {},
    })
    state.tools.set(itemId, block)
  }
  return block
}

function completeText(state: StreamState, key: string, text: unknown): void {
  const existing = state.texts.get(key)
  if (!existing && !text) return
  const block = existing ?? textBlock(state, key)
  if (!block.sent && typeof text === 'string' && text) sendDelta(state, block, { type: 'text_delta', text })
  closeBlock(state, block)
}

function completeTool(state: StreamState, block: OpenBlock, args: unknown): void {
  const json = stringifyOpenAIToolArguments(args)
  if (!block.sent && json) sendDelta(state, block, { type: 'input_json_delta', partial_json: json })
  closeBlock(state, block)
}

function completeOutputItem(state: StreamState, data: Record<string, unknown>): void {
  const item = data.item as Record<string, unknown> | undefined
  if (item?.type === 'function_call') {
    completeTool(state, toolBlock(state, item), item.arguments)
    return
  }
  if (item?.type === 'reasoning') {
    completeReasoning(state, item)
    return
  }
  if (item?.type !== 'message' || !Array.isArray(item.content)) return
  for (const [contentIndex, part] of (item.content as Array<Record<string, unknown>>).entries()) {
    if (part.type === 'output_text' || part.type === 'refusal') {
      completeText(state, textKey(data, contentIndex), part.text ?? part.refusal)
    }
  }
}

function finishMessage(
  state: StreamState,
  status: string | undefined,
  incompleteReason: string | undefined,
  usage: OpenAIResponsesUsage | undefined,
): void {
  const finish = mapResponsesStatus(status, incompleteReason, state.tools.size > 0)
  if ('error' in finish) {
    emitError(state, finish.error)
    return
  }

  ensureMessageStart(state)
  const open = [...state.texts.values(), ...state.tools.values(), ...state.reasoning.values()]
    .sort((a, b) => a.index - b.index)
  for (const block of open) closeBlock(state, block)

  state.emit('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: finish.stopReason, stop_sequence: null },
    ...(usage && { usage: mapResponsesUsage(usage) }),
  })
  state.messageStopped = true
  state.emit('message_stop', { type: 'message_stop' })
}

function processEvent(event: string, data: Record<string, unknown>, state: StreamState): void {
  switch (event) {
    case 'response.created': {
      ensureMessageStart(state)
      break
    }

    case 'response.output_item.added': {
      ensureMessageStart(state)
      const item = data.item as Record<string, unknown> | undefined
      if (item?.type !== 'function_call') break
      const block = toolBlock(state, item)
      const json = stringifyOpenAIToolArguments(item.arguments)
      if (json) sendDelta(state, block, { type: 'input_json_delta', partial_json: json })
      break
    }

    case 'response.content_part.added': {
      ensureMessageStart(state)
      const part = data.part as Record<string, unknown> | undefined
      if (part?.type === 'output_text' || part?.type === 'refusal') textBlock(state, textKey(data))
      break
    }

    case 'response.output_text.delta':
    case 'response.refusal.delta': {
      const delta = (data.delta as string) || ''
      if (delta) sendDelta(state, textBlock(state, textKey(data)), { type: 'text_delta', text: delta })
      break
    }

    case 'response.function_call_arguments.delta': {
      const block = state.tools.get((data.item_id as string) || '')
      const delta = stringifyOpenAIToolArguments(data.delta)
      if (block && delta) sendDelta(state, block, { type: 'input_json_delta', partial_json: delta })
      break
    }

    case 'response.output_text.done':
    case 'response.refusal.done': {
      completeText(state, textKey(data), data.text ?? data.refusal)
      break
    }

    case 'response.function_call_arguments.done': {
      const block = state.tools.get((data.item_id as string) || '')
      if (block) completeTool(state, block, data.arguments)
      break
    }

    case 'response.output_item.done': {
      completeOutputItem(state, data)
      break
    }

    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta': {
      const delta = (data.delta as string) || ''
      if (delta) sendThinking(state, reasoningBlock(state, (data.item_id as string) || ''), delta)
      break
    }

    case 'response.reasoning_summary_text.done':
    case 'response.reasoning_text.done':
    case 'response.reasoning_summary_part.done': {
      const block = state.reasoning.get((data.item_id as string) || '')
      if (block) block.partDone = true
      break
    }

    case 'response.failed':
    case 'error': {
      emitError(state, errorFromEvent(data))
      break
    }

    case 'response.incomplete':
    case 'response.completed': {
      const response = data.response as Record<string, unknown> | undefined
      const details = response?.incomplete_details as { reason?: string } | undefined
      finishMessage(
        state,
        (response?.status as string) || 'completed',
        details?.reason,
        response?.usage as OpenAIResponsesUsage | undefined,
      )
      break
    }
  }
}
