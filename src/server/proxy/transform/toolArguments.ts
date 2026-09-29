import type { AnthropicContentBlock } from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseOpenAIToolArguments(value: unknown): Record<string, unknown> {
  if (value == null || value === '') return {}

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return isRecord(parsed) ? parsed : { raw: parsed }
    } catch {
      return { raw: value }
    }
  }

  if (isRecord(value)) return value

  return { raw: value }
}

export function stringifyOpenAIToolArguments(value: unknown): string {
  if (value == null || value === '') return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * Extract a string representation of a tool_result's content for forwarding
 * to OpenAI-compatible providers (whose tool/function outputs only accept
 * strings). Text blocks are joined; non-text blocks (images, etc.) become
 * placeholders so the model at least knows something was returned rather
 * than silently dropping it.
 */
export function extractToolResultContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text)
    } else if (block.type === 'image') {
      parts.push(`[image omitted: ${block.source.media_type}]`)
    } else if (block.type === 'tool_use') {
      parts.push(`[nested tool_use: ${block.name}]`)
    } else if (block.type === 'thinking') {
      parts.push(`[nested thinking]`)
    } else {
      parts.push(`[omitted content: ${(block as { type: string }).type}]`)
    }
  }
  return parts.join('\n')
}
