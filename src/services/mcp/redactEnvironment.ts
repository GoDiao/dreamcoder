/** Redact likely secrets from connection diagnostics, including JSON echoes. */
export function createMcpEnvironmentRedactor(env?: Record<string, string>): (message: string) => string {
  // Name-based selection keeps ordinary flags, modes and paths readable, even
  // when their values are long. Keep this rule aligned with the desktop helper.
  const values = Object.entries(env ?? {})
    .filter(([name, value]) => /TOKEN|KEY|SECRET|PASSWORD|AUTH/i.test(name) && value.length > 0)
    .map(([, value]) => value)
  if (values.length === 0) return message => message

  const spellings = [...new Set(values.flatMap(value => [value, JSON.stringify(value).slice(1, -1)]))]
    .sort((a, b) => b.length - a.length)
    .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(spellings.join('|'), 'g')
  return message => message.replace(pattern, '[redacted]')
}
