export type StandaloneLimits = { entryBytes: number; assetBytes: number; totalBytes: number }

export type StandaloneResult =
  | { ok: true; html: string; externalLinks: string[] }
  | { ok: false; reason: 'entry' | 'asset' | 'total'; limitBytes: number; items: Array<{ url: string; bytes: number }> }

export async function buildStandaloneHtml(limits: StandaloneLimits): Promise<StandaloneResult> {
  const external = new Set<string>()
  const assets: Array<{ url: string; bytes: number }> = []
  const dataUris = new Map<string, string | null>()
  const stylesheets = new Map<string, string | null>()
  let total = 0

  const failure = (reason: 'entry' | 'asset' | 'total', limitBytes: number): StandaloneResult => ({
    ok: false,
    reason,
    limitBytes,
    items: [...assets].sort((a, b) => b.bytes - a.bytes).slice(0, 5),
  })

  const resolveUrl = (raw: string, base: string): URL | null => {
    try {
      return new URL(raw, base)
    } catch {
      return null
    }
  }

  const classify = (raw: string, base: string): URL | null => {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#') || /^(data|blob|about|javascript):/i.test(trimmed)) return null
    const url = resolveUrl(trimmed, base)
    if (!url) return null
    if (url.protocol === location.protocol && url.host === location.host) return url
    if (/^https?:$/.test(url.protocol)) external.add(url.href)
    return null
  }

  const download = async (url: URL): Promise<{ bytes: Uint8Array; type: string } | null> => {
    let response: Response
    try {
      response = await fetch(url.href)
    } catch {
      return null
    }
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    assets.push({ url: url.href, bytes: bytes.length })
    if (bytes.length > limits.assetBytes) throw { reason: 'asset', limitBytes: limits.assetBytes }
    total += bytes.length
    if (total > limits.totalBytes) throw { reason: 'total', limitBytes: limits.totalBytes }
    return { bytes, type: response.headers.get('content-type') ?? 'application/octet-stream' }
  }

  const toDataUri = async (raw: string, base: string): Promise<string | null> => {
    const url = classify(raw, base)
    if (!url) return null
    if (dataUris.has(url.href)) return dataUris.get(url.href) ?? null
    const file = await download(url)
    let uri: string | null = null
    if (file) {
      let binary = ''
      for (let index = 0; index < file.bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...file.bytes.subarray(index, index + 0x8000))
      }
      uri = `data:${file.type.split(';')[0]};base64,${btoa(binary)}`
    }
    dataUris.set(url.href, uri)
    return uri
  }

  const replaceAsync = async (text: string, pattern: RegExp, replacer: (match: RegExpExecArray) => Promise<string>) => {
    let result = ''
    let last = 0
    for (const match of text.matchAll(pattern)) {
      result += text.slice(last, match.index) + (await replacer(match as RegExpExecArray))
      last = (match.index ?? 0) + match[0].length
    }
    return result + text.slice(last)
  }

  const inlineCss = async (css: string, base: string, depth: number): Promise<string> => {
    const imported = await replaceAsync(
      css,
      /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')\s*[^;]*;/gi,
      async (match) => {
        const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
        const url = classify(raw, base)
        if (!url || depth >= 5) return match[0]
        let text = stylesheets.get(url.href)
        if (text === undefined) {
          const file = await download(url)
          text = file ? new TextDecoder().decode(file.bytes) : null
          stylesheets.set(url.href, text)
        }
        return text === null ? match[0] : inlineCss(text, url.href, depth + 1)
      },
    )
    return replaceAsync(imported, /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi, async (match) => {
      const raw = match[1] ?? match[2] ?? match[3] ?? ''
      const uri = await toDataUri(raw, base)
      return uri ? `url("${uri}")` : match[0]
    })
  }

  const inlineSrcset = (value: string, base: string) =>
    replaceAsync(value, /\s*([^\s,]+)(\s+[^,]+)?\s*(?:,|$)/g, async (match) => {
      const uri = await toDataUri(match[1] ?? '', base)
      return `${uri ?? match[1]}${match[2] ?? ''}, `
    }).then((text) => text.replace(/,\s*$/, ''))

  const base = document.baseURI
  if (new Blob([document.documentElement.outerHTML]).size > limits.entryBytes) return failure('entry', limits.entryBytes)

  try {
    const root = document.documentElement.cloneNode(true) as HTMLElement

    const pageStyles = Array.from(root.querySelectorAll('style'))
    for (const link of Array.from(root.querySelectorAll('link[rel~="stylesheet"][href]'))) {
      const url = classify(link.getAttribute('href') ?? '', base)
      if (!url) continue
      let text = stylesheets.get(url.href)
      if (text === undefined) {
        const file = await download(url)
        text = file ? new TextDecoder().decode(file.bytes) : null
        stylesheets.set(url.href, text)
      }
      if (text === null) continue
      const style = document.createElement('style')
      const media = link.getAttribute('media')
      if (media) style.setAttribute('media', media)
      style.textContent = await inlineCss(text, url.href, 0)
      link.replaceWith(style)
    }
    for (const style of pageStyles) {
      style.textContent = await inlineCss(style.textContent ?? '', base, 0)
    }
    for (const element of Array.from(root.querySelectorAll('[style]'))) {
      const value = element.getAttribute('style') ?? ''
      if (value.includes('url(')) element.setAttribute('style', await inlineCss(value, base, 0))
    }
    for (const script of Array.from(root.querySelectorAll('script[src]'))) {
      const url = classify(script.getAttribute('src') ?? '', base)
      if (!url) continue
      const file = await download(url)
      if (!file) continue
      script.removeAttribute('src')
      script.textContent = new TextDecoder().decode(file.bytes).replace(/<\/script/gi, '<\\/script')
    }
    const attributes: Array<[string, string]> = [
      ['img[src]', 'src'],
      ['source[src]', 'src'],
      ['video[src]', 'src'],
      ['audio[src]', 'src'],
      ['video[poster]', 'poster'],
      ['input[type="image"][src]', 'src'],
      ['link[rel~="icon"][href]', 'href'],
    ]
    for (const [selector, name] of attributes) {
      for (const element of Array.from(root.querySelectorAll(selector))) {
        const uri = await toDataUri(element.getAttribute(name) ?? '', base)
        if (uri) element.setAttribute(name, uri)
      }
    }
    for (const element of Array.from(root.querySelectorAll('[srcset]'))) {
      element.setAttribute('srcset', await inlineSrcset(element.getAttribute('srcset') ?? '', base))
    }

    const html = `<!DOCTYPE html>\n${root.outerHTML}`
    if (new Blob([html]).size > limits.totalBytes) return failure('total', limits.totalBytes)
    return { ok: true, html, externalLinks: [...external] }
  } catch (error) {
    const limit = error as { reason?: 'asset' | 'total'; limitBytes?: number }
    if (limit && (limit.reason === 'asset' || limit.reason === 'total') && typeof limit.limitBytes === 'number') {
      return failure(limit.reason, limit.limitBytes)
    }
    throw error
  }
}

export function standaloneHtmlSource(limits: StandaloneLimits) {
  return `(${buildStandaloneHtml.toString()})(${JSON.stringify(limits)})`
}
