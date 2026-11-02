import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildStandaloneHtml, standaloneHtmlSource, type StandaloneLimits } from './standaloneHtml'

const LIMITS: StandaloneLimits = { entryBytes: 1_000_000, assetBytes: 50_000, totalBytes: 200_000 }
const origin = location.origin

const files = new Map<string, { body: string | Uint8Array; type: string }>()
const fetched: string[] = []

function install() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetched.push(url)
    const file = files.get(url)
    if (!file) return new Response('missing', { status: 404 })
    return new Response(file.body as BodyInit, { status: 200, headers: { 'content-type': file.type } })
  }))
}

const file = (path: string, body: string | Uint8Array, type: string) => files.set(`${origin}${path}`, { body, type })
const dataUri = (text: string, type: string) => `data:${type};base64,${btoa(text)}`

async function build(limits = LIMITS) {
  const result = await buildStandaloneHtml(limits)
  if (!result.ok) throw new Error(`build failed: ${result.reason}`)
  return result
}

describe('standalone HTML', () => {
  beforeEach(() => {
    files.clear()
    fetched.length = 0
    install()
    document.documentElement.innerHTML = '<head><title>Doc</title></head><body></body>'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('inlines a same-origin stylesheet, its imports and the images and fonts its rules refer to', async () => {
    file('/a/style.css', '@import "base.css";\nbody{background:url(bg.png)} @font-face{font-family:F;src:url("f.woff2")}', 'text/css')
    file('/a/base.css', 'h1{color:red}', 'text/css')
    file('/a/bg.png', 'PNG', 'image/png')
    file('/a/f.woff2', 'FONT', 'font/woff2')
    document.head.innerHTML += `<base href="${origin}/a/"><link rel="stylesheet" href="style.css">`

    const { html } = await build()

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).not.toContain('<link rel="stylesheet"')
    expect(html).toContain('h1{color:red}')
    expect(html).toContain(dataUri('PNG', 'image/png'))
    expect(html).toContain(dataUri('FONT', 'font/woff2'))
  })

  it('resolves the urls of an inlined stylesheet against the stylesheet and not against the page', async () => {
    file('/css/a.css', 'body{background:url(img/x.png)}', 'text/css')
    file('/img/x.png', 'PAGELEVEL', 'image/png')
    document.head.innerHTML += '<link rel="stylesheet" href="/css/a.css">'

    const { html } = await build()

    expect(html).toContain('url(img/x.png)')
    expect(html).not.toContain(dataUri('PAGELEVEL', 'image/png'))
  })

  it('inlines a same-origin script without letting it end the script element', async () => {
    file('/app.js', 'document.title="x"; var s="</script>";', 'text/javascript')
    document.body.innerHTML = '<script src="/app.js"></script>'

    const { html } = await build()

    expect(html).not.toContain('src="/app.js"')
    expect(html).toContain('document.title="x"; var s="<\\/script>";')
  })

  it('turns images, srcset candidates, posters and icons into data URIs', async () => {
    file('/one.png', 'ONE', 'image/png')
    file('/two.png', 'TWO', 'image/png')
    file('/p.jpg', 'POSTER', 'image/jpeg')
    file('/i.ico', 'ICON', 'image/x-icon')
    document.head.innerHTML += '<link rel="icon" href="/i.ico">'
    document.body.innerHTML = '<img src="/one.png" srcset="/one.png 1x, /two.png 2x"><video poster="/p.jpg"></video>'

    const { html } = await build()

    expect(html).toContain(`src="${dataUri('ONE', 'image/png')}"`)
    expect(html).toContain(`${dataUri('TWO', 'image/png')} 2x`)
    expect(html).toContain(`poster="${dataUri('POSTER', 'image/jpeg')}"`)
    expect(html).toContain(`href="${dataUri('ICON', 'image/x-icon')}"`)
  })

  it('inlines styles in style elements and style attributes', async () => {
    file('/bg.png', 'PNG', 'image/png')
    document.head.innerHTML += '<style>.a{background:url(/bg.png)}</style>'
    document.body.innerHTML = '<div style="background-image:url(/bg.png)"></div>'

    const { html } = await build()

    expect(html.split(dataUri('PNG', 'image/png')).length - 1).toBe(2)
    expect(fetched.filter((url) => url.endsWith('/bg.png'))).toHaveLength(1)
  })

  it('keeps external addresses and reports each one once', async () => {
    document.head.innerHTML += '<link rel="stylesheet" href="https://cdn.example.com/a.css"><script src="https://cdn.example.com/a.js"></script>'
    document.body.innerHTML = '<img src="https://img.example.com/x.png"><img src="https://img.example.com/x.png"><a href="https://example.com/page">go</a>'

    const result = await build()

    expect(result.html).toContain('https://cdn.example.com/a.css')
    expect(result.html).toContain('https://img.example.com/x.png')
    expect(result.externalLinks.sort()).toEqual(['https://cdn.example.com/a.css', 'https://cdn.example.com/a.js', 'https://img.example.com/x.png'])
    expect(fetched).toEqual([])
  })

  it('leaves data URIs, fragments and missing files alone', async () => {
    document.body.innerHTML = `<img src="${dataUri('X', 'image/png')}"><img src="/missing.png"><svg><use href="#a"></use></svg>`

    const { html, externalLinks } = await build()

    expect(html).toContain('src="/missing.png"')
    expect(externalLinks).toEqual([])
  })

  it('does not change the page it was run on', async () => {
    file('/one.png', 'ONE', 'image/png')
    document.body.innerHTML = '<img src="/one.png">'
    await build()
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/one.png')
  })

  it('fails with the biggest assets when one is over the asset limit', async () => {
    file('/big.png', new Uint8Array(60_000), 'image/png')
    file('/small.png', 'x', 'image/png')
    document.body.innerHTML = '<img src="/small.png"><img src="/big.png">'

    const result = await buildStandaloneHtml(LIMITS)

    expect(result).toEqual({
      ok: false,
      reason: 'asset',
      limitBytes: 50_000,
      items: [{ url: `${origin}/big.png`, bytes: 60_000 }, { url: `${origin}/small.png`, bytes: 1 }],
    })
  })

  it('fails when the assets together are over the total limit', async () => {
    file('/a.png', new Uint8Array(40_000), 'image/png')
    file('/b.png', new Uint8Array(40_000), 'image/png')
    const result = await buildStandaloneHtml({ ...LIMITS, assetBytes: 50_000, totalBytes: 70_000 })
    expect(result.ok).toBe(true)

    document.body.innerHTML = '<img src="/a.png"><img src="/b.png">'
    const failed = await buildStandaloneHtml({ ...LIMITS, assetBytes: 50_000, totalBytes: 70_000 })
    expect(failed).toMatchObject({ ok: false, reason: 'total', limitBytes: 70_000 })
  })

  it('fails when the document itself is over the entry limit before fetching anything', async () => {
    document.body.innerHTML = `<p>${'x'.repeat(2_000)}</p><img src="/one.png">`
    const result = await buildStandaloneHtml({ ...LIMITS, entryBytes: 1_000 })
    expect(result).toMatchObject({ ok: false, reason: 'entry', limitBytes: 1_000 })
    expect(fetched).toEqual([])
  })

  it('runs from its own source in a page that has nothing else', async () => {
    file('/one.png', 'ONE', 'image/png')
    document.body.innerHTML = '<img src="/one.png">'
    const result = (await Function(`return ${standaloneHtmlSource(LIMITS)}`)()) as { ok: boolean; html: string }
    expect(result.ok).toBe(true)
    expect(result.html).toContain(dataUri('ONE', 'image/png'))
  })
})
