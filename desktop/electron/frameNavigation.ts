const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])
const PAGE_PATH_PREFIX = '/ui-pages/'

export function isAllowedFrameNavigation(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.href === 'about:srcdoc') return true
  return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname) && parsed.pathname.startsWith(PAGE_PATH_PREFIX)
}
