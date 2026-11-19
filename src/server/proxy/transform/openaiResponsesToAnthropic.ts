import type {
  OpenAIResponsesResponse,
  OpenAIResponsesOutputItem,
  OpenAIResponsesUsage,
  AnthropicResponse,
  AnthropicContentBlock,
} from './types.js'
import {
  apiError,
  contentFilterError,
  UpstreamReplyError,
} from '../../upstream/upstreamError.js'
import type { ResolvedModelRules } from '../../types/modelRules.js'
import type { ChatFinish } from './openaiChatToAnthropic.js'
import { reasoningSignature } from './reasoningReplay.js'
import { parseOpenAIToolArguments } from './toolArguments.js'

export function responsesReasoningSignature(item: Record<string, unknown>, rules: ResolvedModelRules): string | undefined {
  const encrypted = item.encrypted_content
  return typeof encrypted === 'string' && encrypted ? reasoningSignature(rules, 'encrypted_content', encrypted) : undefined
}

export function responsesReasoningText(item: Record<string, unknown>): string {
  if (!Array.isArray(item.summary)) return ''
  return (item.summary as Array<Record<string, unknown>>)
    .map(part => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n\n')
}

export function openaiResponsesToAnthropic(
  response: OpenAIResponsesResponse,
  model: string,
  rules: ResolvedModelRules,
): AnthropicResponse {
  const content: AnthropicContentBlock[] = []
  let hasToolUse = false

  for (const item of response.output || []) {
    convertOutputItem(item, content, rules)
    if (item.type === 'function_call') hasToolUse = true
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }

  const finish = mapResponsesStatus(response.status, response.incomplete_details?.reason, hasToolUse)
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
    usage: mapResponsesUsage(response.usage),
  }
}

// OpenAI counts cached tokens inside input_tokens; Anthropic's input_tokens excludes cache reads.
export function mapResponsesUsage(usage?: OpenAIResponsesUsage): AnthropicResponse['usage'] {
  const legacy = usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0
  return {
    input_tokens: Math.max(0, (usage?.input_tokens ?? legacy?.prompt_tokens ?? 0) - cached),
    output_tokens: usage?.output_tokens ?? legacy?.completion_tokens ?? 0,
    ...(cached ? { cache_read_input_tokens: cached } : {}),
  }
}

function convertOutputItem(item: OpenAIResponsesOutputItem, content: AnthropicContentBlock[], rules: ResolvedModelRules): void {
  switch (item.type) {
    case 'message': {
      for (const part of item.content || []) {
        if (part.type === 'output_text' || part.type === 'text') {
          content.push({ type: 'text', text: part.text || '' })
        } else if (part.type === 'refusal') {
          content.push({ type: 'text', text: part.refusal || '[Refusal]' })
        }
      }
      break
    }
    case 'function_call': {
      content.push({
        type: 'tool_use',
        id: item.call_id,
        name: item.name,
        input: parseOpenAIToolArguments(item.arguments),
      })
      break
    }
    case 'reasoning': {
      const thinking = responsesReasoningText(item)
      const signature = responsesReasoningSignature(item, rules)
      if (signature) content.push({ type: 'thinking', thinking, signature })
      else if (thinking) content.push({ type: 'thinking', thinking })
      break
    }
  }
}

export function mapResponsesStatus(status: string | undefined, incompleteReason: string | undefined, hasToolUse: boolean): ChatFinish {
  if (status !== 'incomplete') return { stopReason: hasToolUse ? 'tool_use' : 'end_turn' }
  if (!incompleteReason || incompleteReason === 'max_output_tokens') return { stopReason: 'max_tokens' }
  if (incompleteReason === 'content_filter') return { error: contentFilterError(`incomplete: ${incompleteReason}`) }
  return { error: apiError(`The provider ended the reply before it finished (incomplete: ${incompleteReason}).`) }
}
