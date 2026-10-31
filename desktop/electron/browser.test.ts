import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_PARTITION } from '../src/lib/shell/electronBridge'
import {
  classifyUrl,
  chromeUserAgent,
  installBrowser,
  PROJECT_SCHEME,
  ProjectRoots,
  resolveBrowserInput,
  searchUrl,
  serveProjectRequest,
  systemTargetFor,
  type BrowserSessionLike,
  type GuestLike,
} from './browser'

let dir = ''
let project = ''
let outside = ''
let roots: ProjectRoots

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'electron-browser-'))
  project = path.join(dir, 'project')
  outside = path.join(dir, 'outside')
  mkdirSync(path.join(project, 'docs'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(path.join(project, 'index.html'), '<h1>home</h1>')
  writeFileSync(path.join(project, 'docs', 'my page.html'), '<h1>docs</h1>')
  writeFileSync(path.join(project, 'notes.txt'), 'notes')
  writeFileSync(path.join(outside, 'secret.html'), 'secret')
  symlinkSync(path.join(outside, 'secret.html'), path.join(project, 'link.html'))
  roots = new ProjectRoots()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function projectUrl(file = 'index.html') {
  const result = await resolveBrowserInput(file, project, roots)
  if (!result.ok) throw new Error(`expected ${file} to resolve`)
  return result.url
}

async function projectBase() {
  const url = new URL(await projectUrl())
  return `${url.protocol}//${url.host}`
}

describe('classifyUrl', () => {
  it('allows loopback http, https and registered project files', async () => {
    const url = await projectUrl()
    expect(classifyUrl('http://localhost:3000/a', roots)).toBe('allow')
    expect(classifyUrl('http://127.0.0.1:5173', roots)).toBe('allow')
    expect(classifyUrl('https://example.com/path', roots)).toBe('allow')
    expect(classifyUrl(url, roots)).toBe('allow')
  })

  it('refuses everything else on the web and local files', () => {
    expect(classifyUrl('http://example.com', roots)).toBe('refuse')
    expect(classifyUrl('http://localhost.evil.com', roots)).toBe('refuse')
    expect(classifyUrl('http://[::1]:3000', roots)).toBe('refuse')
    expect(classifyUrl('https://user:pass@example.com', roots)).toBe('refuse')
    expect(classifyUrl('file:///etc/passwd', roots)).toBe('refuse')
    expect(classifyUrl('javascript:alert(1)', roots)).toBe('refuse')
    expect(classifyUrl('data:text/html,hi', roots)).toBe('refuse')
    expect(classifyUrl('chrome://settings', roots)).toBe('refuse')
    expect(classifyUrl(`${PROJECT_SCHEME}://unknown/index.html`, roots)).toBe('refuse')
    expect(classifyUrl('not a url', roots)).toBe('refuse')
  })

  it('hands other schemes to the external-protocol prompt', () => {
    expect(classifyUrl('vscode://file/a', roots)).toBe('external')
    expect(classifyUrl('zoommtg://zoom.us/join', roots)).toBe('external')
  })
})

describe('resolveBrowserInput', () => {
  it('turns bare local addresses into http and other hosts into https', async () => {
    await expect(resolveBrowserInput('localhost:3000', project, roots)).resolves.toEqual({ ok: true, url: 'http://localhost:3000/' })
    await expect(resolveBrowserInput('127.0.0.1:5173/app', project, roots)).resolves.toEqual({ ok: true, url: 'http://127.0.0.1:5173/app' })
    await expect(resolveBrowserInput('example.com', project, roots)).resolves.toEqual({ ok: true, url: 'https://example.com/' })
    await expect(resolveBrowserInput('https://example.com/a?b=1', null, roots)).resolves.toEqual({ ok: true, url: 'https://example.com/a?b=1' })
  })

  it('refuses plain http sites and other schemes', async () => {
    await expect(resolveBrowserInput('http://example.com', project, roots)).resolves.toEqual({ ok: false, reason: 'scheme' })
    await expect(resolveBrowserInput('vscode://file/a', project, roots)).resolves.toEqual({ ok: false, reason: 'scheme' })
    await expect(resolveBrowserInput('javascript:alert(1)', project, roots)).resolves.toEqual({ ok: false, reason: 'scheme' })
    await expect(resolveBrowserInput('two words', project, roots)).resolves.toEqual({ ok: false, reason: 'scheme' })
    await expect(resolveBrowserInput('   ', project, roots)).resolves.toEqual({ ok: false, reason: 'scheme' })
  })

  it('opens html files inside the project by relative path, absolute path and file url', async () => {
    const expected = await projectUrl('index.html')
    expect(expected).toMatch(new RegExp(`^${PROJECT_SCHEME}://[0-9a-f]{32}/index\\.html$`))
    await expect(resolveBrowserInput('./index.html', project, roots)).resolves.toEqual({ ok: true, url: expected })
    await expect(resolveBrowserInput(path.join(project, 'index.html'), project, roots)).resolves.toEqual({ ok: true, url: expected })
    const fileUrl = new URL(`file://${path.join(project, 'index.html')}`).toString()
    await expect(resolveBrowserInput(fileUrl, project, roots)).resolves.toEqual({ ok: true, url: expected })
    const nested = await resolveBrowserInput('docs/my page.html', project, roots)
    expect(nested).toMatchObject({ ok: true })
    expect(nested.ok && nested.url.endsWith('/docs/my%20page.html')).toBe(true)
  })

  it('refuses files outside the project, missing files, non-html files and no project', async () => {
    const secret = path.join(outside, 'secret.html')
    await expect(resolveBrowserInput(secret, project, roots)).resolves.toEqual({ ok: false, reason: 'outsideProject' })
    await expect(resolveBrowserInput('../outside/secret.html', project, roots)).resolves.toEqual({ ok: false, reason: 'outsideProject' })
    await expect(resolveBrowserInput('../outside/missing.html', project, roots)).resolves.toEqual({ ok: false, reason: 'outsideProject' })
    await expect(resolveBrowserInput('./link.html', project, roots)).resolves.toEqual({ ok: false, reason: 'outsideProject' })
    await expect(resolveBrowserInput(`file://${secret}`, project, roots)).resolves.toEqual({ ok: false, reason: 'outsideProject' })
    await expect(resolveBrowserInput('./missing.html', project, roots)).resolves.toEqual({ ok: false, reason: 'notFound' })
    await expect(resolveBrowserInput('./docs', project, roots)).resolves.toEqual({ ok: false, reason: 'notFound' })
    await expect(resolveBrowserInput('./notes.txt', project, roots)).resolves.toEqual({ ok: false, reason: 'notHtml' })
    await expect(resolveBrowserInput('./index.html', null, roots)).resolves.toEqual({ ok: false, reason: 'noProject' })
    await expect(resolveBrowserInput('./index.html', path.join(dir, 'gone'), roots)).resolves.toEqual({ ok: false, reason: 'noProject' })
  })
})

describe('searching from the address bar', () => {
  const search = { engine: 'bing' }
  const bing = (query: string) => ({ ok: true, url: `https://www.bing.com/search?q=${query}` })

  it('searches for words, phrases and text that does not look like a host', async () => {
    await expect(resolveBrowserInput('weather', project, roots, search)).resolves.toEqual(bing('weather'))
    await expect(resolveBrowserInput('react hooks', project, roots, search)).resolves.toEqual(bing('react%20hooks'))
    await expect(resolveBrowserInput('天气', project, roots, search)).resolves.toEqual(bing('%E5%A4%A9%E6%B0%94'))
    await expect(resolveBrowserInput('  react hooks  ', null, roots, search)).resolves.toEqual(bing('react%20hooks'))
    await expect(resolveBrowserInput('example.com cats', project, roots, search)).resolves.toEqual(bing('example.com%20cats'))
    await expect(resolveBrowserInput('index', project, roots, search)).resolves.toEqual(bing('index'))
  })

  it('keeps hosts, localhost, ip literals and host:port as addresses', async () => {
    await expect(resolveBrowserInput('example.com', project, roots, search)).resolves.toEqual({ ok: true, url: 'https://example.com/' })
    await expect(resolveBrowserInput('example.com/a?b=1', project, roots, search)).resolves.toEqual({ ok: true, url: 'https://example.com/a?b=1' })
    await expect(resolveBrowserInput('localhost', project, roots, search)).resolves.toEqual({ ok: true, url: 'http://localhost/' })
    await expect(resolveBrowserInput('localhost/app', project, roots, search)).resolves.toEqual({ ok: true, url: 'http://localhost/app' })
    await expect(resolveBrowserInput('localhost:3000', project, roots, search)).resolves.toEqual({ ok: true, url: 'http://localhost:3000/' })
    await expect(resolveBrowserInput('192.168.1.5', project, roots, search)).resolves.toEqual({ ok: true, url: 'https://192.168.1.5/' })
    await expect(resolveBrowserInput('127.0.0.1:5173', project, roots, search)).resolves.toEqual({ ok: true, url: 'http://127.0.0.1:5173/' })
    await expect(resolveBrowserInput('[2001:db8::1]', project, roots, search)).resolves.toEqual({ ok: true, url: 'https://[2001:db8::1]/' })
    await expect(resolveBrowserInput('[::1]:8443/x', project, roots, search)).resolves.toEqual({ ok: true, url: 'https://[::1]:8443/x' })
    await expect(resolveBrowserInput('devbox:8080', project, roots, search)).resolves.toEqual({ ok: true, url: 'https://devbox:8080/' })
  })

  it('does not search for file paths, inputs with a scheme or files in the project', async () => {
    const expected = await projectUrl('index.html')
    await expect(resolveBrowserInput('./index.html', project, roots, search)).resolves.toEqual({ ok: true, url: expected })
    await expect(resolveBrowserInput('index.html', project, roots, search)).resolves.toEqual({ ok: true, url: expected })
    await expect(resolveBrowserInput('./missing.html', project, roots, search)).resolves.toEqual({ ok: false, reason: 'notFound' })
    await expect(resolveBrowserInput('../outside/secret.html', project, roots, search)).resolves.toEqual({ ok: false, reason: 'outsideProject' })
    await expect(resolveBrowserInput('notes.txt', project, roots, search)).resolves.toEqual({ ok: false, reason: 'notHtml' })
    await expect(resolveBrowserInput('https://example.com/a b', project, roots, search)).resolves.toEqual({ ok: true, url: 'https://example.com/a%20b' })
    await expect(resolveBrowserInput('http://example.com', project, roots, search)).resolves.toEqual({ ok: false, reason: 'scheme' })
    await expect(resolveBrowserInput('javascript:alert(1)', project, roots, search)).resolves.toEqual({ ok: false, reason: 'scheme' })
    await expect(resolveBrowserInput('   ', project, roots, search)).resolves.toEqual({ ok: false, reason: 'scheme' })
  })

  it('encodes the query for each engine', () => {
    expect(searchUrl('天气 a&b=c#d+e', 'bing')).toBe('https://www.bing.com/search?q=%E5%A4%A9%E6%B0%94%20a%26b%3Dc%23d%2Be')
    expect(searchUrl('天气 a&b=c#d+e', 'google')).toBe('https://www.google.com/search?q=%E5%A4%A9%E6%B0%94%20a%26b%3Dc%23d%2Be')
    expect(searchUrl('天气 a&b=c#d+e', 'duckduckgo')).toBe('https://duckduckgo.com/?q=%E5%A4%A9%E6%B0%94%20a%26b%3Dc%23d%2Be')
    expect(searchUrl('天气 a&b=c#d+e', 'baidu')).toBe('https://www.baidu.com/s?wd=%E5%A4%A9%E6%B0%94%20a%26b%3Dc%23d%2Be')
  })

  it.each(['google', 'duckduckgo', 'baidu'])('resolves a search through %s as an allowed https page', async (engine) => {
    const result = await resolveBrowserInput('react hooks', project, roots, { engine })
    expect(result).toEqual({ ok: true, url: searchUrl('react hooks', engine) })
    expect(result.ok && classifyUrl(result.url, roots)).toBe('allow')
  })

  it.each([undefined, null, '', 'yahoo', 'BING', 42, { id: 'google' }])('falls back to the default engine for %p', async (engine) => {
    await expect(resolveBrowserInput('react hooks', project, roots, { engine })).resolves.toEqual(bing('react%20hooks'))
  })

  it('never searches when the caller does not ask for it', async () => {
    for (const input of ['天气', 'react hooks', 'weather', 'two words', 'index']) {
      await expect(resolveBrowserInput(input, project, roots)).resolves.toEqual({ ok: false, reason: 'scheme' })
      await expect(resolveBrowserInput(input, null, roots)).resolves.toEqual({ ok: false, reason: 'scheme' })
    }
    await expect(resolveBrowserInput('example.com', project, roots)).resolves.toEqual({ ok: true, url: 'https://example.com/' })
    await expect(resolveBrowserInput('localhost:3000', project, roots)).resolves.toEqual({ ok: true, url: 'http://localhost:3000/' })
    await expect(resolveBrowserInput('index.html', project, roots)).resolves.toMatchObject({ ok: true })
  })
})

describe('project files', () => {
  const read = async (file: string) => new Response(`read:${path.basename(file)}`)

  it('serves files below the root, including subresources', async () => {
    const notes = `${await projectBase()}/notes.txt`
    const response = await serveProjectRequest(notes, roots, read)
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('read:notes.txt')
  })

  it('refuses traversal, symlinks out of the root and unknown roots', async () => {
    const origin = await projectBase()
    const reader = vi.fn(read)
    expect((await serveProjectRequest(`${origin}/%2e%2e%2foutside%2fsecret.html`, roots, reader)).status).toBe(403)
    expect((await serveProjectRequest(`${origin}/..%2foutside%2fsecret.html`, roots, reader)).status).toBe(403)
    expect((await serveProjectRequest(`${origin}/link.html`, roots, reader)).status).toBe(403)
    expect((await serveProjectRequest(`${PROJECT_SCHEME}://unknown/index.html`, roots, reader)).status).toBe(403)
    expect((await serveProjectRequest(`${origin}/%00`, roots, reader)).status).toBe(403)
    expect((await serveProjectRequest(`${origin}/nope.html`, roots, reader)).status).toBe(404)
    expect((await serveProjectRequest(`${origin}/docs`, roots, reader)).status).toBe(404)
    expect(reader).not.toHaveBeenCalled()
  })

  it('names the file or url the system should open', async () => {
    const url = await projectUrl()
    await expect(systemTargetFor(url, roots)).resolves.toEqual({ kind: 'path', value: path.join(realpathSync(project), 'index.html') })
    await expect(systemTargetFor('https://example.com/', roots)).resolves.toEqual({ kind: 'url', value: 'https://example.com/' })
    await expect(systemTargetFor('http://localhost:3000/', roots)).resolves.toEqual({ kind: 'url', value: 'http://localhost:3000/' })
    await expect(systemTargetFor('vscode://file/a', roots)).resolves.toBeNull()
    await expect(systemTargetFor('file:///etc/passwd', roots)).resolves.toBeNull()
  })
})

type Listener = (...args: never[]) => void

function fakeHost() {
  const listeners = new Map<string, Listener>()
  return {
    listeners,
    on(event: string, listener: Listener) {
      listeners.set(event, listener)
    },
    emit(event: string, ...args: unknown[]) {
      return (listeners.get(event) as unknown as (...rest: unknown[]) => unknown)(...args)
    },
  }
}

const ELECTRON_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) dreamcoder/0.4.0 Chrome/140.0.7339.41 Electron/45.1.0 Safari/537.36'

function fakeSession() {
  const handlers: Record<string, unknown> = {}
  const session: BrowserSessionLike = {
    getUserAgent: () => ELECTRON_USER_AGENT,
    setUserAgent: (userAgent) => { handlers.userAgent = userAgent },
    setPermissionRequestHandler: (handler) => { handlers.request = handler },
    setPermissionCheckHandler: (handler) => { handlers.check = handler },
    setDevicePermissionHandler: (handler) => { handlers.device = handler },
    setDisplayMediaRequestHandler: (handler) => { handlers.display = handler },
    protocol: { handle: (scheme, handler) => { handlers[`protocol:${scheme}`] = handler } },
  }
  return { session, handlers }
}

const MENU_LABELS = { addToChat: 'Add to chat', copy: 'Copy' }

function install(options: { labels?: typeof MENU_LABELS | null } = {}) {
  const host = fakeHost()
  const { session, handlers } = fakeSession()
  const notify = vi.fn()
  const popupMenu = vi.fn()
  const labels = options.labels === undefined ? MENU_LABELS : options.labels
  installBrowser({
    host,
    session,
    roots,
    readFile: async () => new Response('file'),
    notify,
    popupMenu,
    menuLabels: () => labels,
  })
  return { host, handlers, notify, popupMenu }
}

describe('will-attach-webview', () => {
  it('drops the preload and forces the sandbox settings', () => {
    const { host } = install()
    const event = { preventDefault: vi.fn() }
    const webPreferences: Record<string, unknown> = {
      preload: '/app/preload.cjs',
      preloadURL: 'file:///app/preload.cjs',
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      webviewTag: true,
      enableBlinkFeatures: 'Anything',
      additionalArguments: ['--x'],
    }
    const params: Record<string, unknown> = { src: 'https://example.com/', partition: BROWSER_PARTITION, allowpopups: '' }
    host.emit('will-attach-webview', event, webPreferences, params)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(webPreferences).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    })
    for (const key of ['preload', 'preloadURL', 'enableBlinkFeatures', 'additionalArguments']) {
      expect(webPreferences).not.toHaveProperty(key)
    }
  })

  it('rejects guests outside the browsing partition', () => {
    const { host } = install()
    for (const partition of ['persist:other', 'other', undefined]) {
      const event = { preventDefault: vi.fn() }
      host.emit('will-attach-webview', event, {}, { src: 'https://example.com/', partition })
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
  })

  it('rejects guests that start on a disallowed address or have none', () => {
    const { host } = install()
    for (const src of ['file:///etc/passwd', 'http://example.com/', 'vscode://x', 'about:blank', undefined]) {
      const event = { preventDefault: vi.fn() }
      host.emit('will-attach-webview', event, {}, { src, partition: BROWSER_PARTITION })
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
  })
})

describe('browser session', () => {
  it('denies every permission, device and display capture request', () => {
    const { handlers } = install()
    const callback = vi.fn()
    ;(handlers.request as (...args: unknown[]) => void)({}, 'media', callback)
    ;(handlers.request as (...args: unknown[]) => void)({}, 'geolocation', callback)
    expect(callback.mock.calls).toEqual([[false], [false]])
    expect((handlers.check as () => boolean)()).toBe(false)
    expect((handlers.device as () => boolean)()).toBe(false)
    const display = vi.fn()
    ;(handlers.display as (...args: unknown[]) => void)({}, display)
    expect(display).toHaveBeenCalledWith({})
  })

  it('serves project files on this session only', async () => {
    const { handlers } = install()
    const origin = await projectBase()
    const handle = handlers[`protocol:${PROJECT_SCHEME}`] as (request: { url: string }) => Promise<Response>
    expect((await handle({ url: `${origin}/index.html` })).status).toBe(200)
    expect((await handle({ url: `${origin}/..%2foutside%2fsecret.html` })).status).toBe(403)
  })
})

function attachGuest(host: ReturnType<typeof fakeHost>) {
  const guestHandlers = new Map<string, Listener>()
  let windowOpen: ((details: { url: string }) => { action: 'deny' }) | undefined
  const guest: GuestLike = {
    id: 7,
    setWindowOpenHandler: (handler) => { windowOpen = handler },
    on: (event, listener) => { guestHandlers.set(event, listener) },
    loadURL: vi.fn(),
    getURL: () => 'https://example.com/page',
    getTitle: () => 'Example\n page',
    copy: vi.fn(),
    executeJavaScriptInIsolatedWorld: vi.fn(async () => false),
  }
  host.emit('did-attach-webview', {}, guest)
  const call = (event: string, ...args: unknown[]) =>
    (guestHandlers.get(event) as unknown as (...rest: unknown[]) => unknown)(...args)
  return { guest, call, open: (url: string) => windowOpen?.({ url }) }
}

describe('guest navigation', () => {
  it('lets the main frame move between allowed addresses', () => {
    const { host, notify } = install()
    const { call } = attachGuest(host)
    const event = { preventDefault: vi.fn() }
    call('will-navigate', event, 'https://example.com/next')
    call('will-navigate', event, 'http://localhost:3000/')
    call('will-redirect', event, 'https://example.com/after', false, true)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('cancels and reports main-frame navigation to disallowed addresses', () => {
    const { host, notify } = install()
    const { call } = attachGuest(host)
    for (const url of ['http://example.com/', 'file:///etc/passwd', 'javascript:alert(1)']) {
      const event = { preventDefault: vi.fn() }
      call('will-navigate', event, url)
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(notify).toHaveBeenLastCalledWith('browser-blocked', { guestId: 7, url, reason: 'scheme' })
    }
    const redirect = { preventDefault: vi.fn() }
    call('will-redirect', redirect, 'http://example.com/', false, true)
    expect(redirect.preventDefault).toHaveBeenCalledOnce()
  })

  it('asks about external protocols instead of following them', () => {
    const { host, notify } = install()
    const { call } = attachGuest(host)
    const event = { preventDefault: vi.fn() }
    call('will-navigate', event, 'zoommtg://zoom.us/join')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith('browser-external-request', { url: 'zoommtg://zoom.us/join' })
  })

  it('keeps subframes off local files and external schemes without prompting', () => {
    const { host, notify } = install()
    const { call } = attachGuest(host)
    const blocked = { preventDefault: vi.fn(), url: 'file:///etc/passwd', isMainFrame: false }
    call('will-frame-navigate', blocked)
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    const allowed = { preventDefault: vi.fn(), url: 'https://example.com/embed', isMainFrame: false }
    call('will-frame-navigate', allowed)
    const blank = { preventDefault: vi.fn(), url: 'about:blank', isMainFrame: false }
    call('will-frame-navigate', blank)
    const mainFrame = { preventDefault: vi.fn(), url: 'http://example.com/', isMainFrame: true }
    call('will-frame-navigate', mainFrame)
    expect(allowed.preventDefault).not.toHaveBeenCalled()
    expect(blank.preventDefault).not.toHaveBeenCalled()
    expect(mainFrame.preventDefault).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('opens allowed popups in the same guest and denies every window', () => {
    const { host, notify } = install()
    const { guest, open } = attachGuest(host)
    expect(open('https://example.com/popup')).toEqual({ action: 'deny' })
    expect(guest.loadURL).toHaveBeenCalledWith('https://example.com/popup')
    expect(open('http://example.com/popup')).toEqual({ action: 'deny' })
    expect(open('vscode://file/a')).toEqual({ action: 'deny' })
    expect(guest.loadURL).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith('browser-blocked', { guestId: 7, url: 'http://example.com/popup', reason: 'scheme' })
    expect(notify).toHaveBeenCalledWith('browser-external-request', { url: 'vscode://file/a' })
  })

  it('forwards app shortcuts but not editing keys', () => {
    const { host, notify } = install()
    const { call } = attachGuest(host)
    const input = (key: string, extra: Record<string, unknown> = {}) => ({
      type: 'keyDown', key, code: `Key${key.toUpperCase()}`, control: false, meta: true, shift: false, alt: false, ...extra,
    })
    call('before-input-event', {}, input('k'))
    expect(notify).toHaveBeenCalledWith('browser-shortcut', {
      key: 'k', code: 'KeyK', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false,
    })
    notify.mockClear()
    call('before-input-event', {}, input('c'))
    call('before-input-event', {}, input('V'))
    call('before-input-event', {}, input('k', { type: 'keyUp' }))
    call('before-input-event', {}, input('k', { meta: false }))
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('user agent', () => {
  it('presents the browsing session as plain Chrome, without the app and Electron tokens', () => {
    const { handlers } = install()

    expect(handlers.userAgent).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.41 Safari/537.36')
    expect(chromeUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
  })
})

describe('guest selection menu', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('offers Add to chat and Copy for a selection and reports the cleaned capture', async () => {
    const { host, notify, popupMenu } = install()
    const { guest, call } = attachGuest(host)

    call('context-menu', {}, { selectionText: '  one   two\r\n\r\n\r\n\r\nthree  ', frame: { parent: null } })
    await flush()

    const items = popupMenu.mock.calls[0]?.[0] as { label: string; click(): void }[]
    expect(items.map((item) => item.label)).toEqual(['Add to chat', 'Copy'])
    items[0]?.click()
    expect(notify).toHaveBeenCalledWith('browser-selection', {
      guestId: 7,
      text: 'one two\n\nthree',
      truncated: false,
      title: 'Example page',
      url: 'https://example.com/page',
    })
    items[1]?.click()
    expect(guest.copy).toHaveBeenCalledOnce()
  })

  it('cuts a long selection and says so', async () => {
    const { host, notify, popupMenu } = install()
    const { call } = attachGuest(host)

    call('context-menu', {}, { selectionText: 'x'.repeat(5000), frame: { parent: null } })
    await flush()

    const items = popupMenu.mock.calls[0]?.[0] as { click(): void }[]
    items[0]?.click()
    const payload = notify.mock.calls[0]?.[1] as { text: string; truncated: boolean }
    expect(payload.text).toHaveLength(4000)
    expect(payload.truncated).toBe(true)
  })

  it('leaves out Add to chat when the selection touches a sensitive field', async () => {
    const { host, popupMenu } = install()
    const { guest, call } = attachGuest(host)
    vi.mocked(guest.executeJavaScriptInIsolatedWorld).mockResolvedValue(true)

    call('context-menu', {}, { selectionText: 'secret', frame: { parent: null } })
    await flush()

    const items = popupMenu.mock.calls[0]?.[0] as { label: string }[]
    expect(items.map((item) => item.label)).toEqual(['Copy'])
  })

  it('treats a failed check as sensitive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { host, popupMenu } = install()
    const { guest, call } = attachGuest(host)
    vi.mocked(guest.executeJavaScriptInIsolatedWorld).mockRejectedValue(new Error('gone'))

    call('context-menu', {}, { selectionText: 'text', frame: { parent: null } })
    await flush()

    const items = popupMenu.mock.calls[0]?.[0] as { label: string }[]
    expect(items.map((item) => item.label)).toEqual(['Copy'])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('does not offer a selection made inside a subframe', async () => {
    const { host, popupMenu } = install()
    const { guest, call } = attachGuest(host)

    call('context-menu', {}, { selectionText: 'text', frame: { parent: {} } })
    await flush()

    const items = popupMenu.mock.calls[0]?.[0] as { label: string }[]
    expect(items.map((item) => item.label)).toEqual(['Copy'])
    expect(guest.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })

  it('shows no menu without a selection or before the labels are known', async () => {
    const empty = install()
    const first = attachGuest(empty.host)
    first.call('context-menu', {}, { selectionText: '   ', frame: { parent: null } })
    await flush()
    expect(empty.popupMenu).not.toHaveBeenCalled()
    expect(first.guest.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()

    const unlabeled = install({ labels: null })
    const second = attachGuest(unlabeled.host)
    second.call('context-menu', {}, { selectionText: 'text', frame: { parent: null } })
    await flush()
    expect(unlabeled.popupMenu).not.toHaveBeenCalled()
  })
})
