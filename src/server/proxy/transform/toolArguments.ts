import { parseSseJson } from '../streaming/sse.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseOpenAIToolArguments(value: unknown): Record<string, unknown> | string {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return {}
  if (isRecord(value)) return value
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  const parsed = parseSseJson(raw)
  if (parsed === null) return {}
  return isRecord(parsed) ? parsed : raw
}

export function stringifyOpenAIToolArguments(value: unknown): string {
  if (value == null || value === '') return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}
