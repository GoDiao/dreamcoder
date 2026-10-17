/** Redact configured values from connection diagnostics, including JSON echoes. */
export function createMcpEnvironmentRedactor(env?: Record<string, string>): (message: string) => string {
  const values = Object.values(env ?? {}).filter(value => value.length > 0)
  if (values.length === 0) return message => message

  const spellings = [...new Set(values.flatMap(value => [value, JSON.stringify(value).slice(1, -1)]))]
    .sort((a, b) => b.length - a.length)
    .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(spellings.join('|'), 'g')
  return message => message.replace(pattern, '[redacted]')
}
