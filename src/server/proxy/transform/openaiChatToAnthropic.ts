import type {
  OpenAIChatResponse,
  AnthropicResponse,
  AnthropicContentBlock,
} from './types.js'
import { parseOpenAIToolArguments } from './toolArguments.js'

export function openaiChatToAnthropic(response: OpenAIChatResponse, model: string): AnthropicResponse {
  const choice = response.choices?.[0]
  if (!choice) {
    return createEmptyResponse(response, model)
  }

  const content: AnthropicContentBlock[] = []

  const msg = choice.message as Record<string, unknown>

  if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
    content.push({ type: 'thinking', thinking: msg.reasoning_content })
  }
  else if (typeof msg.reasoning === 'string' && msg.reasoning) {
    content.push({ type: 'thinking', thinking: msg.reasoning })
  }
  else if (Array.isArray(msg.thinking_blocks)) {
    for (const tb of msg.thinking_blocks as Array<Record<string, unknown>>) {
      if (tb.type === 'thinking' && typeof tb.thinking === 'string') {
        content.push({ type: 'thinking', thinking: tb.thinking, signature: tb.signature as string | undefined })
      }
    }
  }

  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content })
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

  return {
    id: response.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: response.model || model,
    stop_reason: mapStopReason(choice.finish_reason, content.some((block) => block.type === 'tool_use')),
    stop_sequence: null,
    usage: mapUsage(response.usage),
  }
}

// Gemini ends a tool-calling turn with finish_reason "stop"; report tool_use whenever the
// message carries tool_use blocks.
function mapStopReason(reason: string | null, hasToolUse: boolean): string {
  const stopReason = mapFinishReason(reason)
  return hasToolUse && stopReason === 'end_turn' ? 'tool_use' : stopReason
}

function mapFinishReason(reason: string | null): string {
  switch (reason) {
    case 'stop': return 'end_turn'
    case 'tool_calls': return 'tool_use'
    case 'length': return 'max_tokens'
    case 'content_filter': return 'end_turn'
    default: return 'end_turn'
  }
}

// OpenAI counts cached tokens inside prompt_tokens; Anthropic's input_tokens excludes cache reads.
export function mapUsage(usage?: OpenAIChatResponse['usage']): AnthropicResponse['usage'] {
  if (!usage) {
    return { input_tokens: 0, output_tokens: 0 }
  }
  const cached = usage.prompt_tokens_details?.cached_tokens || 0
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
    model: response.model || model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: mapUsage(response.usage),
  }
}
