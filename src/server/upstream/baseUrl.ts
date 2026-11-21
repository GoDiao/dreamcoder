const VERSION_SEGMENT = /^v\d+[a-z0-9]*$/i

export function normalizeUpstreamBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
}

export function openaiUpstreamBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const segments = trimmed.split('/')
  const last = segments.at(-1) ?? ''
  const endsInVersion = VERSION_SEGMENT.test(last)
    || (last.toLowerCase() === 'openai' && VERSION_SEGMENT.test(segments.at(-2) ?? ''))
  return endsInVersion ? trimmed : `${trimmed}/v1`
}

export function hostnameOf(url: string): string {
  return URL.parse(url)?.hostname ?? ''
}
