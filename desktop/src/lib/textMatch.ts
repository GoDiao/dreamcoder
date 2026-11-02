export function matchesQuery(texts: readonly string[], query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || texts.some((text) => text.toLowerCase().includes(needle))
}
