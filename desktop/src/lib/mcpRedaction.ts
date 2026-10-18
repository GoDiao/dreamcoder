/** Match the server's name-based rule; ordinary flags, modes and paths stay readable. */
export function getMcpSecretValues(env?: Record<string, unknown>): string[] {
  return Object.entries(env ?? {})
    .filter(([name, value]) => /TOKEN|KEY|SECRET|PASSWORD|AUTH/i.test(name) && typeof value === 'string' && value.length > 0)
    .map(([, value]) => value as string)
}

export function redactMcpDiagnostic(value: string, secrets: readonly string[]): string
export function redactMcpDiagnostic(value: unknown, secrets: readonly string[]): unknown
export function redactMcpDiagnostic(value: unknown, secrets: readonly string[]): unknown {
  const values = secrets.filter(Boolean)
  if (values.length === 0) return value

  // Match raw and JSON-escaped values in one pass, longest first. Replacement
  // markers are never scanned again, even when a secret is part of "[redacted]".
  const spellings = [...new Set(values.flatMap(secret => [secret, JSON.stringify(secret).slice(1, -1)]))]
    .sort((a, b) => b.length - a.length)
    .map(secret => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(spellings.join('|'), 'g')

  function redact(input: unknown): unknown {
    if (typeof input === 'string') return input.replace(pattern, '[redacted]')
    if (Array.isArray(input)) return input.map(redact)
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([key, entry]) => [redact(key), redact(entry)]))
    }
    return input
  }

  return redact(value)
}
