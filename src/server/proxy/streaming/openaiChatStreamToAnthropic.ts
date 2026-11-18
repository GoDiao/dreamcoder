import type { OpenAIChatStreamChunk, OpenAIChatUsage } from '../transform/types.js'
import { stringifyOpenAIToolArguments } from '../transform/toolArguments.js'
import { chatUsage, mapChatFinishReason, mapUsage } from '../transform/openaiChatToAnthropic.js'
import {
  anthropicErrorBody,
  apiError,
  readProviderError,
  streamClosedEarlyError,
  toAnthropicError,
  type AnthropicError,
} from '../../upstream/upstreamError.js'
import { parseSseJson, SseDecoder, type SseMessage } from './sse.js'

type ContentBlockType = 'text' | 'thinking' | 'tool_use'

type ToolBlockState = {
  id: string
  name: string
  argsBuffer: string
  started: boolean
  anthropicIndex: number
}

type SseEvent = { event: string; data: unknown }

type StreamState = {
  queue: SseEvent[]

  currentBlockType: ContentBlockType
  currentBlockIndex: number
  nextContentIndex: number
  blockStartSent: boolean
  blockStopSent: boolean

  toolBlocks: Map<number, ToolBlockState>
  sawToolUse: boolean

  model: string
  messageStartSent: boolean
  messageDeltaSent: boolean
  messageStopSent: boolean

  heldMessageDelta: SseEvent | null

  sawValidChunk: boolean
  sawDone: boolean
  sawUsage: boolean
  stopReason: string | null
  upstreamError: AnthropicError | null
}

function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function createState(model: string): StreamState {
  return {
    queue: [],
    currentBlockType: 'text',
    currentBlockIndex: -1,
    nextContentIndex: 0,
    blockStartSent: false,
    blockStopSent: false,
    toolBlocks: new Map(),
    sawToolUse: false,
    model,
    messageStartSent: false,
    messageDeltaSent: false,
    messageStopSent: false,
    heldMessageDelta: null,
    sawValidChunk: false,
    sawDone: false,
    sawUsage: false,
    stopReason: null,
    upstreamError: null,
  }
}

export function openaiChatStreamToAnthropic(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const sse = new SseDecoder()
  const state = createState(model)
  const reader = upstream.getReader()
  let cancelled = false

  return new ReadableStream({
    async start(controller) {
      let errored = false
      const handle = (messages: SseMessage[]) => {
        for (const message of messages) {
          if (message.type === 'event') handleData(message.data.trim(), state, controller, encoder)
          else if (!state.messageStopSent) controller.enqueue(encoder.encode(formatSse('ping', { type: 'ping' })))
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
        if (!state.upstreamError && body) {
          state.upstreamError = readUpstreamError(parseSseJson(body))
        }
      } catch (err) {
        errored = true
        controller.error(err)
      } finally {
        if (!errored && !cancelled) {
          finalizeStream(state)
          flushQueue(state, controller, encoder)
          controller.close()
        }
      }
    },
    cancel(reason) {
      cancelled = true
      return reader.cancel(reason)
    },
  })
}

function handleData(
  data: string,
  state: StreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
): void {
  if (data === '[DONE]') {
    state.sawDone = true
    finalizeStream(state)
    flushQueue(state, controller, encoder)
    return
  }

  const chunk = parseSseJson(data) as OpenAIChatStreamChunk | undefined
  if (!chunk || state.upstreamError) return
  const upstreamError = readUpstreamError(chunk)
  if (upstreamError) {
    state.upstreamError = upstreamError
    finalizeStream(state)
    flushQueue(state, controller, encoder)
    return
  }
  if (Array.isArray(chunk.choices)) state.sawValidChunk = true

  processChunk(chunk, state)
  if (state.upstreamError) finalizeStream(state)
  flushQueue(state, controller, encoder)
}

function enqueue(state: StreamState, event: string, data: unknown): void {
  state.queue.push({ event, data })
}

function flushQueue(
  state: StreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
): void {
  for (const item of state.queue) {
    controller.enqueue(encoder.encode(formatSse(item.event, item.data)))
  }
  state.queue.length = 0
}

function ensureMessageStart(state: StreamState, chunkId?: string): void {
  if (state.messageStartSent) return
  state.messageStartSent = true
  enqueue(state, 'message_start', {
    type: 'message_start',
    message: {
      id: chunkId || `msg_${Date.now()}`,
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

function openBlock(state: StreamState, blockType: ContentBlockType, block: Record<string, unknown>): number {
  const index = state.nextContentIndex++
  state.currentBlockType = blockType
  state.currentBlockIndex = index
  state.blockStartSent = true
  state.blockStopSent = false
  enqueue(state, 'content_block_start', {
    type: 'content_block_start',
    index,
    content_block: block,
  })
  return index
}

function emitDelta(state: StreamState, index: number, delta: Record<string, unknown>): void {
  enqueue(state, 'content_block_delta', {
    type: 'content_block_delta',
    index,
    delta,
  })
}

function closeCurrentBlock(state: StreamState): void {
  if (!state.blockStartSent || state.blockStopSent) return
  state.blockStopSent = true
  enqueue(state, 'content_block_stop', {
    type: 'content_block_stop',
    index: state.currentBlockIndex,
  })
}

function closeAllToolBlocks(state: StreamState): void {
  for (const [, block] of state.toolBlocks) {
    if (block.started) {
      enqueue(state, 'content_block_stop', {
        type: 'content_block_stop',
        index: block.anthropicIndex,
      })
    }
  }
  state.toolBlocks.clear()
  if (state.currentBlockType === 'tool_use') {
    state.blockStopSent = true
  }
}

function closeAllOpenBlocks(state: StreamState): void {
  if (state.currentBlockType !== 'tool_use') {
    closeCurrentBlock(state)
  }
  closeAllToolBlocks(state)
}

type DeltaEx = Record<string, unknown> & {
  content?: string | null
  tool_calls?: Array<{
    index?: number
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
}

function extractReasoning(delta: DeltaEx): { thinking: string; signature: string } | null {
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
    return { thinking: delta.reasoning_content, signature: '' }
  }

  if (typeof delta.reasoning === 'string' && delta.reasoning) {
    return { thinking: delta.reasoning, signature: '' }
  }

  const thinkingBlocks = delta.thinking_blocks as Array<Record<string, unknown>> | undefined
  if (Array.isArray(thinkingBlocks) && thinkingBlocks.length > 0) {
    const block = thinkingBlocks[0]
    if (block.type === 'thinking') {
      const thinking = (block.thinking as string) || ''
      const signature = (block.signature as string) || ''
      if (thinking || signature) {
        return { thinking, signature }
      }
    }
  }

  return null
}

function leaveBlockFor(type: ContentBlockType, state: StreamState): void {
  if (!state.blockStartSent || state.blockStopSent || state.currentBlockType === type) return
  if (state.currentBlockType === 'tool_use') closeAllToolBlocks(state)
  else closeCurrentBlock(state)
}

function processChunk(chunk: OpenAIChatStreamChunk, state: StreamState): void {
  const choice = chunk.choices?.[0]
  const usage = chatUsage(chunk)
  if (usage && state.heldMessageDelta) mergeUsageIntoHeldDelta(state, usage)
  if (!choice) return

  ensureMessageStart(state, chunk.id)

  const delta = choice.delta as DeltaEx

  if (extractReasoning(delta)) {
    leaveBlockFor('thinking', state)
    handleThinking(delta, state)
  }
  if (delta.content != null && delta.content !== '') {
    leaveBlockFor('text', state)
    handleText(delta, state)
  }
  if (delta.tool_calls && delta.tool_calls.length > 0) {
    leaveBlockFor('tool_use', state)
    handleToolCalls(delta, state)
  }

  if (choice.finish_reason) {
    handleFinishReason(choice.finish_reason, usage, state)
  }
}

function handleThinking(delta: DeltaEx, state: StreamState): void {
  const reasoning = extractReasoning(delta)
  if (!reasoning) return

  if (state.currentBlockType !== 'thinking' || !state.blockStartSent) {
    openBlock(state, 'thinking', { type: 'thinking', thinking: '' })
  }

  if (reasoning.thinking) {
    emitDelta(state, state.currentBlockIndex, {
      type: 'thinking_delta', thinking: reasoning.thinking,
    })
  }
  if (reasoning.signature) {
    emitDelta(state, state.currentBlockIndex, {
      type: 'signature_delta', signature: reasoning.signature,
    })
  }
}

function handleText(delta: DeltaEx, state: StreamState): void {
  if (delta.content == null || delta.content === '') return

  if (state.currentBlockType !== 'text' || !state.blockStartSent) {
    openBlock(state, 'text', { type: 'text', text: '' })
  }

  emitDelta(state, state.currentBlockIndex, {
    type: 'text_delta', text: delta.content,
  })
}

// Some OpenAI-compatible servers (Gemini's endpoint) stream every parallel call whole,
// in its own chunk, without `tool_calls[].index`. A delta without an index starts a new
// call when it brings an id that differs from the latest call's, or a name after the
// latest call already has one; anything else continues the latest call.
function toolCallKey(
  tc: { index?: number; id?: string; function?: { name?: string } },
  state: StreamState,
): number {
  if (typeof tc.index === 'number') return tc.index
  let lastKey: number | undefined
  for (const key of state.toolBlocks.keys()) lastKey = key
  if (lastKey === undefined) return 0
  const last = state.toolBlocks.get(lastKey)!
  const startsNewCall = (!!tc.id && tc.id !== last.id) || (!tc.id && !!tc.function?.name && !!last.name)
  return startsNewCall ? lastKey + 1 : lastKey
}

function handleToolCalls(delta: DeltaEx, state: StreamState): void {
  if (!delta.tool_calls) return

  for (const tc of delta.tool_calls) {
    const tcIndex = toolCallKey(tc, state)

    if (!state.toolBlocks.has(tcIndex)) {
      state.toolBlocks.set(tcIndex, {
        id: '', name: '', argsBuffer: '', started: false, anthropicIndex: -1,
      })
    }

    const block = state.toolBlocks.get(tcIndex)!
    if (tc.id) block.id = tc.id
    if (tc.function?.name) block.name += tc.function.name
    const argumentsDelta = stringifyOpenAIToolArguments(tc.function?.arguments)
    if (argumentsDelta) block.argsBuffer += argumentsDelta

    if (!block.started && block.id && block.name) {
      block.started = true
      state.sawToolUse = true
      block.anthropicIndex = state.nextContentIndex++
      state.currentBlockType = 'tool_use'
      state.currentBlockIndex = block.anthropicIndex
      state.blockStartSent = true
      state.blockStopSent = false

      enqueue(state, 'content_block_start', {
        type: 'content_block_start',
        index: block.anthropicIndex,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      })

      if (block.argsBuffer) {
        emitDelta(state, block.anthropicIndex, {
          type: 'input_json_delta', partial_json: block.argsBuffer,
        })
      }
    } else if (block.started && argumentsDelta) {
      emitDelta(state, block.anthropicIndex, {
        type: 'input_json_delta', partial_json: argumentsDelta,
      })
    }
  }
}

function handleFinishReason(
  finishReason: string,
  usage: OpenAIChatUsage | undefined,
  state: StreamState,
): void {
  if (state.messageDeltaSent) return

  const finish = mapChatFinishReason(finishReason, state.sawToolUse)
  if ('error' in finish) {
    state.upstreamError = finish.error
    return
  }

  closeAllOpenBlocks(state)
  state.stopReason = finish.stopReason

  const messageDelta: SseEvent = {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: finish.stopReason, stop_sequence: null },
      ...(usage && { usage: mapUsage(usage) }),
    },
  }

  if (usage) {
    state.sawUsage = true
    state.messageDeltaSent = true
    state.queue.push(messageDelta)
  } else {
    state.heldMessageDelta = messageDelta
  }
}

function mergeUsageIntoHeldDelta(state: StreamState, usage: OpenAIChatUsage): void {
  if (!state.heldMessageDelta) return

  const data = state.heldMessageDelta.data as Record<string, unknown>
  data.usage = mapUsage(usage)
  state.sawUsage = true
  state.messageDeltaSent = true
  state.queue.push(state.heldMessageDelta)
  state.heldMessageDelta = null
}

function readUpstreamError(chunk: unknown): AnthropicError | null {
  const error = (chunk as { error?: unknown } | null)?.error
  if (!error || typeof error !== 'object') return null
  return toAnthropicError(undefined, readProviderError(chunk) ?? { message: 'Upstream returned an error' })
}

function endError(state: StreamState): AnthropicError | null {
  if (state.upstreamError) return state.upstreamError
  if (!state.sawValidChunk) return apiError('Upstream returned no valid Chat Completions chunks')
  if (!state.sawDone && !state.messageDeltaSent && !state.heldMessageDelta) {
    return streamClosedEarlyError()
  }
  if (state.nextContentIndex === 0 && !state.sawUsage && (state.stopReason ?? 'end_turn') === 'end_turn') {
    return apiError('The provider returned an empty reply.')
  }
  return null
}

function finalizeStream(state: StreamState): void {
  if (state.messageStopSent) return
  state.messageStopSent = true

  const error = endError(state)
  if (error) {
    enqueue(state, 'error', anthropicErrorBody(error))
    return
  }

  ensureMessageStart(state)

  closeAllOpenBlocks(state)

  if (state.heldMessageDelta && !state.messageDeltaSent) {
    state.messageDeltaSent = true
    state.queue.push(state.heldMessageDelta)
    state.heldMessageDelta = null
  }

  if (!state.messageDeltaSent) {
    state.messageDeltaSent = true
    enqueue(state, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: state.sawToolUse ? 'tool_use' : 'end_turn', stop_sequence: null },
    })
  }

  enqueue(state, 'message_stop', { type: 'message_stop' })
}
