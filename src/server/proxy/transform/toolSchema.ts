export function cleanToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return cleanValue(schema) as Record<string, unknown>
}

function cleanValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanValue)
  if (!value || typeof value !== 'object') return value

  const cleaned: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (isUnusedKeyword(key, child)) continue
    cleaned[key] = cleanValue(child)
  }
  return cleaned
}

function isUnusedKeyword(key: string, value: unknown): boolean {
  if (key === '$schema') return typeof value === 'string'
  if (key === 'maximum') return value === Number.MAX_SAFE_INTEGER
  if (key === 'minimum') return value === Number.MIN_SAFE_INTEGER
  return false
}
