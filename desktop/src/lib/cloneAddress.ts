export function normalizeCloneAddress(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password || (!url.hostname.includes('.') && url.hostname !== 'localhost')) return null
    return url.toString()
  } catch {
    return null
  }
}
