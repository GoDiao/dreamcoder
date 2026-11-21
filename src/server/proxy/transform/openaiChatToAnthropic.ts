import type {
  OpenAIChatResponse,
  OpenAIChatUsage,
  AnthropicResponse,
  AnthropicContentBlock,
} from './types.js'
import {
  contentFilterError,
  providerSideError,
  UpstreamReplyError,
  type AnthropicError,
} from '../../upstream/upstreamError.js'
import type { ResolvedModelRules } from '../../types/modelRules.js'
import { ChatReasoningBuffer, readChatReasoning } from './reasoningReplay.js'
import { splitThinkTags } from './thinkTags.js'
import { parseOpenAIToolArguments } from './toolArguments.js'

export type ChatFinish = { stopReason: string } | { error: AnthropicError }

function thinkingBlock(thinking: string, signature: string | undefined): AnthropicContentBlock {
  return signature === undefined ? { type: 'thinking', thinking } : { type: 'thinking', thinking, signature }
}

function textBlocks(text: string, rules: ResolvedModelRules): AnthropicContentBlock[] {
  if (!rules.thinkTagsInText) return [{ type: 'text', text }]
  return splitThinkTags(text).map(segment => segment.kind === 'thinking'
    ? thinkingBlock(segment.text, undefined)
    : { type: 'text', text: segment.text })
}

export function openaiChatToAnthropic(response: OpenAIChatResponse, model: string, rules: ResolvedModelRules): AnthropicResponse {
  const choice = response.choices?.[0]
  if (!choice) {
    return createEmptyResponse(response, model)
  }

  const content: AnthropicContentBlock[] = []

  for (const piece of readChatReasoning(choice.message)) {
    const buffer = new ChatReasoningBuffer()
    buffer.add(piece)
    content.push(thinkingBlock(piece.thinking, buffer.signatureFor(rules)))
  }

  if (choice.message.content) {
    content.push(...textBlocks(choice.message.content, rules))
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: parseOpenAIToolArguments(tc.function.arguments),
      })
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }

  const finish = mapChatFinishReason(choice.finish_reason, content.some((block) => block.type === 'tool_use'))
  if ('error' in finish) {
    throw new UpstreamReplyError(finish.error)
  }

  return {
    id: response.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: finish.stopReason,
    stop_sequence: null,
    usage: mapUsage(chatUsage(response)),
  }
}

// Gemini ends a tool-calling turn with finish_reason "stop"; report tool_use whenever the
// message carries tool_use blocks.
export function mapChatFinishReason(reason: string | null, hasToolUse: boolean): ChatFinish {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return { stopReason: 'tool_use' }
    case 'length':
      return { stopReason: 'max_tokens' }
    case 'model_context_window_exceeded':
      return { stopReason: 'model_context_window_exceeded' }
    case 'content_filter':
    case 'sensitive':
      return { error: contentFilterError(`finish_reason: ${reason}`) }
    case 'network_error':
    case 'insufficient_system_resource':
      return { error: providerSideError(`finish_reason: ${reason}`) }
    default:
      return { stopReason: hasToolUse ? 'tool_use' : 'end_turn' }
  }
}

export function chatUsage(
  response: { usage?: OpenAIChatUsage; choices?: Array<{ usage?: OpenAIChatUsage }> },
): OpenAIChatUsage | undefined {
  return response.usage ?? response.choices?.[0]?.usage
}

// OpenAI counts cached tokens inside prompt_tokens; Anthropic's input_tokens excludes cache reads.
export function mapUsage(usage?: OpenAIChatUsage): AnthropicResponse['usage'] {
  if (!usage) {
    return { input_tokens: 0, output_tokens: 0 }
  }
  const cached = usage.prompt_tokens_details?.cached_tokens
    || usage.prompt_cache_hit_tokens
    || usage.cached_tokens
    || 0
  return {
    input_tokens: Math.max(0, (usage.prompt_tokens || 0) - cached),
    output_tokens: usage.completion_tokens || 0,
    cache_read_input_tokens: cached,
  }
}

function createEmptyResponse(response: OpenAIChatResponse, model: string): AnthropicResponse {
  return {
    id: response.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: mapUsage(chatUsage(response)),
  }
}
