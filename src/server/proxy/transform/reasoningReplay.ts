import type { ResolvedModelRules } from '../../types/modelRules.js'
import type { ApiFormat } from '../../types/provider.js'
import type { AnthropicContentBlock, OpenAIChatMessage, OpenAIResponsesInputItem } from './types.js'

type ReasoningSource = 'reasoning_content' | 'reasoning' | 'reasoning_details' | 'encrypted_content' | 'thinking_blocks'

type MarkedReasoning = { source: ReasoningSource; payload: string }
type ThinkingBlock = Extract<AnthropicContentBlock, { type: 'thinking' }>

const SIGNATURE_PREFIX = 'dc1:'
const SOURCES: readonly ReasoningSource[] = ['reasoning_content', 'reasoning', 'reasoning_details', 'encrypted_content', 'thinking_blocks']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function reasoningSignature(rules: ResolvedModelRules, source: ReasoningSource | undefined, payload = ''): string | undefined {
  if (!source || rules.reasoningReplay !== 'same_as_received') return undefined
  return `${SIGNATURE_PREFIX}${source}:${payload}`
}

function readSignature(signature: string | undefined): MarkedReasoning | undefined {
  if (!signature?.startsWith(SIGNATURE_PREFIX)) return undefined
  const rest = signature.slice(SIGNATURE_PREFIX.length)
  const colon = rest.indexOf(':')
  const source = SOURCES.find(candidate => candidate === rest.slice(0, colon))
  if (colon < 0 || !source) {
    console.warn(`[Proxy] Ignoring a reasoning signature with an unknown source: ${rest.slice(0, 40)}`)
    return undefined
  }
  return { source, payload: rest.slice(colon + 1) }
}

function parseDetails(payload: string): unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(payload)
    if (Array.isArray(parsed)) return parsed
  } catch (error) {
    console.warn(`[Proxy] Ignoring unreadable reasoning_details in a reasoning signature: ${String(error)}`)
    return undefined
  }
  console.warn('[Proxy] Ignoring reasoning_details in a reasoning signature that are not an array')
  return undefined
}

function accepted(source: ReasoningSource, rules: ResolvedModelRules, apiFormat: ApiFormat): boolean {
  switch (source) {
    case 'reasoning_details':
      return rules.reasoningDialect === 'openrouter'
    case 'encrypted_content':
      return apiFormat === 'openai_responses'
    case 'reasoning_content':
    case 'reasoning':
      return apiFormat === 'openai_chat'
    case 'thinking_blocks':
      return false
  }
}

function acceptedMark(block: ThinkingBlock, rules: ResolvedModelRules, apiFormat: ApiFormat): MarkedReasoning | undefined {
  const marked = readSignature(block.signature)
  return marked && accepted(marked.source, rules, apiFormat) ? marked : undefined
}

export function chatReasoningReplay(
  blocks: ThinkingBlock[],
  rules: ResolvedModelRules,
): Pick<OpenAIChatMessage, 'reasoning_content' | 'reasoning' | 'reasoning_details'> {
  let reasoningContent = ''
  let reasoning = ''
  const details: unknown[] = []
  for (const block of blocks) {
    const marked = acceptedMark(block, rules, 'openai_chat')
    if (!marked) {
      if (rules.unmarkedReasoningReplay === 'reasoning_content') reasoningContent += block.thinking
      continue
    }
    if (rules.reasoningReplay === 'off') continue
    if (marked.source === 'reasoning_content') reasoningContent += block.thinking
    else if (marked.source === 'reasoning') reasoning += block.thinking
    else if (marked.source === 'reasoning_details') {
      const parsed = parseDetails(marked.payload)
      if (parsed) details.push(...parsed)
      else if (rules.unmarkedReasoningReplay === 'reasoning_content') reasoningContent += block.thinking
    }
  }
  return {
    ...(reasoningContent && { reasoning_content: reasoningContent }),
    ...(reasoning && { reasoning }),
    ...(details.length > 0 && { reasoning_details: details }),
  }
}

export function responsesReasoningItem(
  block: ThinkingBlock,
  rules: ResolvedModelRules,
): OpenAIResponsesInputItem | undefined {
  const marked = acceptedMark(block, rules, 'openai_responses')
  if (!marked || rules.reasoningReplay === 'off' || marked.source !== 'encrypted_content') return undefined
  return {
    type: 'reasoning',
    summary: block.thinking ? [{ type: 'summary_text', text: block.thinking }] : [],
    encrypted_content: marked.payload,
  }
}

type ChatReasoningPiece = {
  thinking: string
  source: ReasoningSource
  details?: unknown[]
  signature?: string
}

function detailsText(details: unknown[]): string {
  return details
    .map(detail => isRecord(detail) ? (typeof detail.text === 'string' ? detail.text : typeof detail.summary === 'string' ? detail.summary : '') : '')
    .join('')
}

export function readChatReasoning(message: Record<string, unknown>): ChatReasoningPiece[] {
  if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
    return [{ thinking: message.reasoning_content, source: 'reasoning_content' }]
  }
  if (Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0) {
    const thinking = typeof message.reasoning === 'string' ? message.reasoning : detailsText(message.reasoning_details)
    return [{ thinking, source: 'reasoning_details', details: message.reasoning_details }]
  }
  if (typeof message.reasoning === 'string' && message.reasoning) {
    return [{ thinking: message.reasoning, source: 'reasoning' }]
  }
  if (!Array.isArray(message.thinking_blocks)) return []
  return message.thinking_blocks.flatMap(block => {
    if (!isRecord(block) || block.type !== 'thinking') return []
    const thinking = typeof block.thinking === 'string' ? block.thinking : ''
    const signature = typeof block.signature === 'string' ? block.signature : ''
    return thinking || signature ? [{ thinking, source: 'thinking_blocks' as const, signature }] : []
  })
}

const CONCATENATED_DETAIL_FIELDS = new Set(['text', 'summary', 'data'])

export class ChatReasoningBuffer {
  private source: ReasoningSource | undefined
  private details: Record<string, unknown>[] = []
  private signature = ''

  add(piece: ChatReasoningPiece): void {
    if (piece.source === 'reasoning_details' || !this.source) this.source = piece.source
    if (piece.signature) this.signature = piece.signature
    for (const detail of piece.details ?? []) {
      if (!isRecord(detail)) continue
      const last = this.details.at(-1)
      if (!last || detail.index === undefined || last.index !== detail.index || last.type !== detail.type) {
        this.details.push({ ...detail })
        continue
      }
      for (const [key, value] of Object.entries(detail)) {
        const previous = last[key]
        last[key] = CONCATENATED_DETAIL_FIELDS.has(key) && typeof value === 'string' && typeof previous === 'string'
          ? previous + value
          : value
      }
    }
  }

  signatureFor(rules: ResolvedModelRules): string | undefined {
    if (this.source === 'reasoning_details') return reasoningSignature(rules, this.source, JSON.stringify(this.details))
    if (this.source === 'thinking_blocks') return reasoningSignature(rules, this.source, this.signature)
    return reasoningSignature(rules, this.source)
  }
}
