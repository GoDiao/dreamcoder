export function isClaudeModelName(modelName?: string | null): boolean {
  return typeof modelName === 'string' && modelName.trim().toLowerCase().startsWith('claude')
}
