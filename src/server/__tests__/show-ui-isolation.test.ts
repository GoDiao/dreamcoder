import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { buildReader } from '../../../vendor/showai/build-reader.js'
import { createUiPage } from '../../utils/uiPages.js'
import { sessionService } from '../services/sessionService.js'
import { handleUiPageRequest, isUiPageRequest, uiPageResponse } from '../uiPageHost.js'

function findBrowser(): string | null {
  const fromEnv = process.env.DREAMCODER_TEST_CHROME
  const candidates = [
    fromEnv,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache).filter((name) => name.startsWith('chromium-'))) {
      const app = path.join(cache, entry, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
      candidates.push(app, path.join(cache, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
    }
  }
  return candidates.find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!)) ?? null
}

const browserPath = findBrowser()
const itInBrowser = browserPath ? it : it.skip

type Cdp = {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any>
  close(): void
}

async function connectCdp(url: string): Promise<Cdp> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('devtools connection failed'))
  })
  let nextId = 0
  const pending = new Map<number, (message: any) => void>()
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data))
    pending.get(message.id)?.(message)
  }
  return {
    send(method, params = {}, sessionId) {
      const id = ++nextId
      return new Promise((resolve, reject) => {
        pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)))
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      })
    },
    close: () => socket.close(),
  }
}

async function launchBrowser(userDataDir: string): Promise<{ process: ChildProcess; endpoint: string }> {
  const child = spawn(browserPath!, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-sandbox',
    '--disable-gpu',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise<string>((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error(`browser did not start; stderr: ${JSON.stringify(buffer)}`)), 20000)
    child.stderr!.on('data', (chunk) => {
      buffer += String(chunk)
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
      if (match) {
        clearTimeout(timer)
        resolve(match[1]!)
      }
    })
    child.on('exit', (code, signal) => reject(new Error(`browser exited with code ${code} and signal ${signal}; stderr: ${JSON.stringify(buffer)}`)))
  })
  return { process: child, endpoint }
}

const PAGE_HTML = (beacon: string) => `<!doctype html><html><head><title>probe</title></head><body><p id="content">probe page</p><script>
const results = {}
const attempt = async (name, run) => {
  try {
    results[name] = 'allowed:' + String(await run()).slice(0, 60)
  } catch (error) {
    results[name] = 'blocked:' + (error && error.name)
  }
}
const addTo = (parent, tag, attributes) => new Promise((resolve) => {
  const element = document.createElement(tag)
  Object.assign(element, attributes)
  element.onload = () => resolve('loaded')
  element.onerror = () => resolve('error')
  parent.append(element)
  setTimeout(() => resolve('pending'), 700)
})
;(async () => {
  await attempt('parentDocument', () => window.parent.document.title)
  await attempt('parentBridge', () => window.parent.electronBridge.secret)
  await attempt('parentStorage', () => window.parent.localStorage.getItem('app-secret'))
  await attempt('topDocument', () => window.top.document.title)
  await attempt('ownLocalStorage', () => localStorage.getItem('app-secret'))
  await attempt('ownSessionStorage', () => sessionStorage.length)
  await attempt('ownCookie', () => document.cookie)
  await attempt('indexedDB', () => indexedDB.databases())
  await attempt('apiFetch', () => fetch('/api/secret').then((response) => response.text()))
  await attempt('networkFetch', () => fetch('${beacon}/fetch', { mode: 'no-cors' }))
  await attempt('xhr', () => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('GET', '${beacon}/xhr')
    request.onload = () => resolve(request.status)
    request.onerror = () => reject(new Error('xhr'))
    request.send()
  }))
  await attempt('webSocket', () => new Promise((resolve, reject) => {
    const socket = new WebSocket('${beacon.replace('http', 'ws')}/ws')
    socket.onopen = () => resolve('open')
    socket.onerror = () => reject(new Error('ws'))
  }))
  await attempt('eventSource', () => new Promise((resolve, reject) => {
    const source = new EventSource('${beacon}/sse')
    source.onopen = () => resolve('open')
    source.onerror = () => reject(new Error('sse'))
  }))
  await attempt('sendBeacon', () => navigator.sendBeacon('${beacon}/beacon', 'x') || Promise.reject(new Error('refused')))
  await attempt('image', () => addTo(document.body, 'img', { src: '${beacon}/img.png' }))
  await attempt('script', () => addTo(document.head, 'script', { src: '${beacon}/script.js' }))
  await attempt('stylesheet', () => addTo(document.head, 'link', { rel: 'stylesheet', href: '${beacon}/style.css' }))
  await attempt('frame', () => addTo(document.body, 'iframe', { src: '${beacon}/frame' }))
  await attempt('font', () => new FontFace('x', 'url(${beacon}/font.woff2)').load())
  await attempt('form', () => {
    const form = document.createElement('form')
    form.action = '${beacon}/form'
    form.method = 'post'
    document.body.append(form)
    form.submit()
    return 'submitted'
  })
  await attempt('popup', () => window.open('${beacon}/popup') || Promise.reject(new Error('refused')))
  await attempt('topNavigation', () => { window.top.location.href = '${beacon}/top'; return 'navigated' })
  window.parent.postMessage({ probe: results }, '*')
})()
</script></body></html>`

const HOST_HTML = (pageUrl: string) => `<!doctype html><html><body>
<iframe id="frame" sandbox="allow-scripts" src="${pageUrl}" style="width:400px;height:300px"></iframe>
<script>
window.electronBridge = { secret: 'bridge-secret' }
localStorage.setItem('app-secret', 'storage-secret')
document.cookie = 'session=cookie-secret; path=/'
window.hostAlive = true
window.addEventListener('message', (event) => {
  if (event.source === document.getElementById('frame').contentWindow && event.data && event.data.probe) window.probe = event.data.probe
})
</script></body></html>`

const PAGE_HOST_HTML = (pageUrl: string) => `<!doctype html><html><body>
<iframe id="frame" sandbox="allow-scripts" src="${pageUrl}" style="width:800px;height:600px"></iframe>
<script>
window.heights = []
window.addEventListener('message', (event) => {
  const frame = document.getElementById('frame').contentWindow
  const message = event.data
  if (event.source !== frame || !message || message.jsonrpc !== '2.0') return
  if (message.method === 'ui/initialize') frame.postMessage({ jsonrpc: '2.0', id: message.id, result: { hostContext: { theme: 'light' } } }, '*')
  if (message.method === 'ui/notifications/size-changed') window.heights.push(message.params.height)
})
</script></body></html>`

describe('page frame isolation in a real browser', () => {
  let workDir = ''
  let app: ReturnType<typeof Bun.serve>
  let beacon: ReturnType<typeof Bun.serve>
  let browser: { process: ChildProcess; endpoint: string } | null = null
  let cdp: Cdp | null = null
  let pageId = ''
  let htmlPageId = ''
  let probeHtml = ''
  const previousDistDir = process.env.CLAUDE_H5_DIST_DIR
  const beaconHits: string[] = []
  const apiHits: string[] = []

  beforeAll(async () => {
    if (!browserPath) return
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'show-ui-isolation-'))
    beacon = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, server) {
        beaconHits.push(new URL(req.url).pathname)
        if (server.upgrade(req)) return undefined
        return new Response('beacon', { headers: { 'Access-Control-Allow-Origin': '*' } })
      },
      websocket: { message() {} },
    })
    const beaconOrigin = `http://127.0.0.1:${beacon.port}`
    probeHtml = PAGE_HTML(beaconOrigin)
    await buildReader(path.join(workDir, 'dist', 'showai-reader'))
    process.env.CLAUDE_H5_DIST_DIR = path.join(workDir, 'dist')
    pageId = (await createUiPage(workDir, {
      title: 'Chart',
      blocks: [{ kind: 'chart', data: { title: 'Revenue', type: 'bar', labels: ['Q1', 'Q2'], series: [{ name: 'Revenue', values: [3, 5] }] } }],
    })).pageId
    htmlPageId = (await createUiPage(workDir, {
      title: 'Concept',
      blocks: [{
        kind: 'html',
        data: {
          reason: 'No component draws this.',
          html: `<!doctype html><html><body style="margin:0"><div id="box" style="height:420px"></div><script>document.getElementById('box').textContent='drawn';fetch('${beaconOrigin}/html-fetch').catch(()=>{});new Image().src='${beaconOrigin}/html-image';</script></body></html>`,
        },
      }],
    })).pageId
    spyOn(sessionService, 'getSessionDataDir').mockResolvedValue(workDir)
    app = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/probe') return uiPageResponse(probeHtml)
        if (isUiPageRequest(url)) return handleUiPageRequest(req, url)
        if (url.pathname === '/api/secret') {
          apiHits.push(req.headers.get('origin') ?? 'none')
          return new Response('api-secret')
        }
        const html = url.pathname === '/page'
          ? PAGE_HOST_HTML(`/ui-pages/isolation/${pageId}/1`)
          : url.pathname === '/html-page'
            ? PAGE_HOST_HTML(`/ui-pages/isolation/${htmlPageId}/1`)
            : HOST_HTML('/probe')
        return new Response(html, { headers: { 'Content-Type': 'text/html' } })
      },
    })
    browser = await launchBrowser(path.join(workDir, 'profile'))
    cdp = await connectCdp(browser.endpoint)
  }, 60000)

  afterAll(async () => {
    if (previousDistDir === undefined) delete process.env.CLAUDE_H5_DIST_DIR
    else process.env.CLAUDE_H5_DIST_DIR = previousDistDir
    cdp?.close()
    browser?.process.kill()
    beacon?.stop(true)
    app?.stop(true)
    if (workDir) await fs.rm(workDir, { recursive: true, force: true })
  })

  async function openHostPage(hostPath = '/host') {
    const { targetId } = await cdp!.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp!.send('Target.attachToTarget', { targetId, flatten: true })
    await cdp!.send('Page.enable', {}, sessionId)
    await cdp!.send('Page.navigate', { url: `http://127.0.0.1:${app.port}${hostPath}` }, sessionId)
    const evaluate = async (expression: string) => {
      const { result } = await cdp!.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
      return result.value
    }
    if (hostPath === '/host') {
      for (let i = 0; i < 100; i++) {
        if (await evaluate('Boolean(window.probe)')) break
        await Bun.sleep(100)
      }
    }
    return { evaluate }
  }

  itInBrowser('keeps the page away from its parent, the app storage and the sidecar API', async () => {
    const { evaluate } = await openHostPage()
    const probe = await evaluate('window.probe')

    expect(probe).toBeTruthy()
    expect(probe.parentDocument).toBe('blocked:SecurityError')
    expect(probe.parentBridge).toBe('blocked:SecurityError')
    expect(probe.parentStorage).toBe('blocked:SecurityError')
    expect(probe.topDocument).toBe('blocked:SecurityError')
    expect(probe.ownLocalStorage).toBe('blocked:SecurityError')
    expect(probe.ownSessionStorage).toBe('blocked:SecurityError')
    expect(probe.ownCookie).toBe('blocked:SecurityError')
    expect(probe.indexedDB).toStartWith('blocked:')
    expect(probe.apiFetch).toStartWith('blocked:')
    expect(apiHits).toEqual([])
    expect(await evaluate('window.hostAlive')).toBe(true)
    expect(await evaluate("document.getElementById('frame').contentDocument === null")).toBe(true)
  }, 30000)

  itInBrowser('keeps the page from loading or sending anything over the network', async () => {
    const { evaluate } = await openHostPage()
    const probe = await evaluate('window.probe')

    for (const name of ['networkFetch', 'xhr', 'webSocket', 'eventSource', 'font', 'popup']) {
      expect(probe[name]).toStartWith('blocked:')
    }
    for (const name of ['image', 'script', 'stylesheet']) {
      expect(probe[name]).not.toBe('loaded')
    }
    await Bun.sleep(500)
    expect(beaconHits).toEqual([])
    expect(await evaluate('window.location.pathname')).toBe('/host')
  }, 30000)

  itInBrowser('renders a stored page with the bundled reader inside the sandbox and without network access', async () => {
    const { evaluate } = await openHostPage('/page')
    let height = 0
    for (let i = 0; i < 100 && height < 200; i++) {
      await Bun.sleep(100)
      height = Math.max(0, ...(await evaluate('window.heights')))
    }

    expect(height).toBeGreaterThan(200)
    expect(beaconHits).toEqual([])
  }, 30000)

  itInBrowser('runs an html block in a nested sandbox that grows with its content and stays offline', async () => {
    const { evaluate } = await openHostPage('/html-page')
    let height = 0
    for (let i = 0; i < 100 && height < 420; i++) {
      await Bun.sleep(100)
      height = Math.max(0, ...(await evaluate('window.heights')))
    }
    await Bun.sleep(300)

    expect(height).toBeGreaterThanOrEqual(420)
    expect(beaconHits).toEqual([])
  }, 30000)
})
