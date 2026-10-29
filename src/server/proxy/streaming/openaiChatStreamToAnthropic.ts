import type { OpenAIChatStreamChunk } from '../transform/types.js'
import { stringifyOpenAIToolArguments } from '../transform/toolArguments.js'
import { mapUsage } from '../transform/openaiChatToAnthropic.js'

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
  upstreamError: string | null
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
    upstreamError: null,
  }
}

export function openaiChatStreamToAnthropic(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffer = ''
  const state = createState(model)
  const reader = upstream.getReader()
  let cancelled = false

  return new ReadableStream({
    async start(controller) {
      let errored = false

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith(':')) continue

            if (trimmed === 'data: [DONE]') {
              finalizeStream(state)
              flushQueue(state, controller, encoder)
              continue
            }

            if (!trimmed.startsWith('data: ')) {
              if (!state.upstreamError && trimmed.startsWith('{')) {
                state.upstreamError = readUpstreamError(parseJson(trimmed))
              }
              continue
            }
            const jsonStr = trimmed.slice(6)

            let chunk: OpenAIChatStreamChunk
            try {
              chunk = JSON.parse(jsonStr)
            } catch {
              continue
            }

            if (state.upstreamError) continue
            const upstreamError = readUpstreamError(chunk)
            if (upstreamError) {
              state.upstreamError = upstreamError
              finalizeStream(state)
              flushQueue(state, controller, encoder)
              continue
            }
            if (Array.isArray(chunk.choices)) state.sawValidChunk = true

            processChunk(chunk, state)
            flushQueue(state, controller, encoder)
          }
        }

        const rest = buffer.trim()
        if (!state.upstreamError && rest.startsWith('{')) {
          state.upstreamError = readUpstreamError(parseJson(rest))
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

function detectBlockTransition(
  delta: DeltaEx,
  state: StreamState,
): { type: ContentBlockType; isNew: boolean } | null {
  if (delta.tool_calls && delta.tool_calls.length > 0) {
    const tc = delta.tool_calls[0]
    const isNew = state.currentBlockType !== 'tool_use' || !!(tc.function?.name)
    return { type: 'tool_use', isNew }
  }

  if (delta.content != null && delta.content !== '') {
    const isNew = state.currentBlockType !== 'text' || !state.blockStartSent
    return { type: 'text', isNew }
  }

  const reasoning = extractReasoning(delta)
  if (reasoning) {
    const isNew = state.currentBlockType !== 'thinking' || !state.blockStartSent
    return { type: 'thinking', isNew }
  }

  return null
}

function processChunk(chunk: OpenAIChatStreamChunk, state: StreamState): void {
  const choice = chunk.choices?.[0]

  if (!choice) {
    if (chunk.usage && state.heldMessageDelta) {
      mergeUsageIntoHeldDelta(state, chunk.usage)
    }
    return
  }

  state.model = chunk.model || state.model
  ensureMessageStart(state, chunk.id)

  const delta = choice.delta as DeltaEx

  const transition = detectBlockTransition(delta, state)

  if (transition) {
    if (transition.isNew && state.blockStartSent && !state.blockStopSent) {
      if (state.currentBlockType === 'tool_use' && transition.type !== 'tool_use') {
        closeAllToolBlocks(state)
      } else if (state.currentBlockType !== 'tool_use') {
        closeCurrentBlock(state)
      }
    }

    switch (transition.type) {
      case 'thinking':
        handleThinking(delta, state)
        break
      case 'text':
        handleText(delta, state)
        break
      case 'tool_use':
        handleToolCalls(delta, state)
        break
    }
  }

  if (choice.finish_reason) {
    handleFinishReason(choice.finish_reason, chunk, state)
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
  chunk: OpenAIChatStreamChunk,
  state: StreamState,
): void {
  if (state.messageDeltaSent) return

  closeAllOpenBlocks(state)

  let stopReason = mapFinishReason(finishReason)
  // Gemini ends a tool-calling turn with finish_reason "stop"; clients that keep going only
  // on stop_reason "tool_use" would otherwise not run the tools.
  if (state.sawToolUse && stopReason === 'end_turn') stopReason = 'tool_use'
  const usage = mapUsage(chunk.usage)

  const messageDelta: SseEvent = {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage,
    },
  }

  if (chunk.usage) {
    state.messageDeltaSent = true
    state.queue.push(messageDelta)
  } else {
    state.heldMessageDelta = messageDelta
  }
}

function mergeUsageIntoHeldDelta(
  state: StreamState,
  usage: NonNullable<OpenAIChatStreamChunk['usage']>,
): void {
  if (!state.heldMessageDelta) return

  const data = state.heldMessageDelta.data as Record<string, unknown>
  data.usage = mapUsage(usage)
  state.messageDeltaSent = true
  state.queue.push(state.heldMessageDelta)
  state.heldMessageDelta = null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function readUpstreamError(chunk: unknown): string | null {
  const error = (chunk as { error?: unknown } | null)?.error
  if (!error || typeof error !== 'object') return null
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message ? message : 'Upstream returned an error'
}

function finalizeStream(state: StreamState): void {
  if (state.messageStopSent) return
  state.messageStopSent = true

  if (state.upstreamError || !state.sawValidChunk) {
    enqueue(state, 'error', {
      type: 'error',
      error: {
        type: 'api_error',
        message: state.upstreamError ?? 'Upstream returned no valid Chat Completions chunks',
      },
    })
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
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 0 },
    })
  }

  enqueue(state, 'message_stop', { type: 'message_stop' })
}

function mapFinishReason(reason: string): string {
  switch (reason) {
    case 'stop': return 'end_turn'
    case 'tool_calls': return 'tool_use'
    case 'length': return 'max_tokens'
    case 'content_filter': return 'end_turn'
    default: return 'end_turn'
  }
}
