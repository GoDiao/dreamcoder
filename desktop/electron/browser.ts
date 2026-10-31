import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_BROWSER_SEARCH_ENGINE,
  isBrowserSearchEngineId,
  type BrowserSearchEngineId,
} from '../../src/server/ws/protocol'
import { normalizeBrowserSelection } from '../src/lib/browserReferences'
import { BROWSER_PARTITION, type BrowserResolveResult } from '../src/lib/shell/electronBridge'
import { SELECTION_PROBE_SOURCE } from './selectionProbe'

export const PROJECT_SCHEME = 'dreamcoder-project'

export const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1'])
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml'])
const EDITING_KEYS = new Set(['a', 'c', 'v', 'x', 'y', 'z'])
const NEVER_EXTERNAL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'file:',
  'data:',
  'blob:',
  'javascript:',
  'about:',
  'chrome:',
  'devtools:',
  'view-source:',
  'filesystem:',
  'ftp:',
  'ws:',
  'wss:',
  'dreamcoder:',
  `${PROJECT_SCHEME}:`,
])
const STRIPPED_PREFERENCE_KEYS = [
  'preload',
  'preloadURL',
  'enableBlinkFeatures',
  'disableBlinkFeatures',
  'additionalArguments',
  'nodeIntegrationInWorker',
]

const SEARCH_URL_TEMPLATES: Record<BrowserSearchEngineId, string> = {
  bing: 'https://www.bing.com/search?q=%s',
  google: 'https://www.google.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  baidu: 'https://www.baidu.com/s?wd=%s',
}

type UrlVerdict = 'allow' | 'external' | 'refuse'
type ProjectFileResult = { file: string } | { status: 403 | 404 }

function isInside(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export class ProjectRoots {
  private readonly rootById = new Map<string, string>()
  private readonly idByRoot = new Map<string, string>()

  has(id: string) {
    return this.rootById.has(id)
  }

  async register(projectRoot: string) {
    const root = await realpath(projectRoot)
    const known = this.idByRoot.get(root)
    if (known) return { id: known, root }
    const id = randomUUID().replaceAll('-', '')
    this.idByRoot.set(root, id)
    this.rootById.set(id, root)
    return { id, root }
  }

  urlFor(id: string, file: string) {
    const root = this.rootById.get(id)
    if (!root) throw new Error('unknown project root')
    const segments = path.relative(root, file).split(path.sep).map(encodeURIComponent)
    return `${PROJECT_SCHEME}://${id}/${segments.join('/')}`
  }

  async fileFor(url: URL): Promise<ProjectFileResult> {
    const root = this.rootById.get(url.hostname)
    if (!root) return { status: 403 }
    let relative: string
    try {
      relative = decodeURIComponent(url.pathname)
    } catch {
      return { status: 403 }
    }
    if (relative.includes('\0')) return { status: 403 }
    const candidate = path.join(root, relative)
    if (!isInside(root, candidate)) return { status: 403 }
    let real: string
    try {
      real = await realpath(candidate)
    } catch {
      return { status: 404 }
    }
    if (!isInside(root, real)) return { status: 403 }
    const info = await stat(real).catch(() => null)
    return info?.isFile() ? { file: real } : { status: 404 }
  }
}

export function classifyUrl(raw: string, roots: ProjectRoots): UrlVerdict {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'refuse'
  }
  if (url.username || url.password) return 'refuse'
  if (url.protocol === 'https:') return 'allow'
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname) ? 'allow' : 'refuse'
  if (url.protocol === `${PROJECT_SCHEME}:`) return roots.has(url.hostname) ? 'allow' : 'refuse'
  return NEVER_EXTERNAL_PROTOCOLS.has(url.protocol) ? 'refuse' : 'external'
}

function looksLikePath(text: string) {
  return path.isAbsolute(text) || /^[a-zA-Z]:[\\/]/.test(text) || /^\.{1,2}[\\/]/.test(text)
}

function looksLikeHostAndPort(text: string) {
  return /^[^/\s:]+:\d+(?:[/?#]|$)/.test(text)
}

function looksLikeAddress(text: string) {
  if (/\s/.test(text)) return false
  const authority = text.split(/[/?#]/, 1)[0]
  if (authority.startsWith('[')) return true
  const hostname = authority.split(':', 1)[0].toLowerCase()
  return hostname.includes('.') || hostname === 'localhost' || looksLikeHostAndPort(text)
}

export function searchUrl(query: string, engine: unknown) {
  const id = isBrowserSearchEngineId(engine) ? engine : DEFAULT_BROWSER_SEARCH_ENGINE
  return SEARCH_URL_TEMPLATES[id].replace('%s', encodeURIComponent(query))
}

function hasScheme(text: string) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)
}

async function resolveProjectFile(
  target: string,
  projectRoot: string | null,
  roots: ProjectRoots,
): Promise<BrowserResolveResult> {
  if (!projectRoot) return { ok: false, reason: 'noProject' }
  const registered = await roots.register(projectRoot).catch(() => null)
  if (!registered) return { ok: false, reason: 'noProject' }
  const { id, root } = registered
  if (!isInside(path.resolve(projectRoot), path.resolve(target))) return { ok: false, reason: 'outsideProject' }
  let real: string
  try {
    real = await realpath(target)
  } catch {
    return { ok: false, reason: 'notFound' }
  }
  if (!isInside(root, real)) return { ok: false, reason: 'outsideProject' }
  const info = await stat(real).catch(() => null)
  if (!info?.isFile()) return { ok: false, reason: 'notFound' }
  if (!HTML_EXTENSIONS.has(path.extname(real).toLowerCase())) return { ok: false, reason: 'notHtml' }
  return { ok: true, url: roots.urlFor(id, real) }
}

function resolveWebAddress(raw: string, roots: ProjectRoots): BrowserResolveResult {
  const verdict = classifyUrl(raw, roots)
  return verdict === 'allow' ? { ok: true, url: new URL(raw).toString() } : { ok: false, reason: 'scheme' }
}

export type BrowserSearchOption = { engine: unknown }

export async function resolveBrowserInput(
  input: string,
  projectRoot: string | null,
  roots: ProjectRoots,
  search?: BrowserSearchOption,
): Promise<BrowserResolveResult> {
  const text = input.trim()
  if (!text) return { ok: false, reason: 'scheme' }
  if (/^file:\/\//i.test(text)) {
    try {
      return resolveProjectFile(fileURLToPath(text), projectRoot, roots)
    } catch {
      return { ok: false, reason: 'scheme' }
    }
  }
  if (looksLikePath(text)) {
    return resolveProjectFile(path.resolve(projectRoot ?? '', text), projectRoot, roots)
  }
  if (!looksLikeHostAndPort(text) && hasScheme(text)) return resolveWebAddress(text, roots)
  if (projectRoot) {
    const candidate = path.join(projectRoot, text)
    if ((await stat(candidate).catch(() => null))?.isFile()) {
      return resolveProjectFile(candidate, projectRoot, roots)
    }
  }
  if (!looksLikeAddress(text)) {
    return search ? resolveWebAddress(searchUrl(text, search.engine), roots) : { ok: false, reason: 'scheme' }
  }
  const hostname = text.split(/[/:?#]/, 1)[0].toLowerCase()
  const scheme = LOOPBACK_HOSTS.has(hostname) ? 'http' : 'https'
  return resolveWebAddress(`${scheme}://${text}`, roots)
}

export async function serveProjectRequest(
  requestUrl: string,
  roots: ProjectRoots,
  readFile: (file: string) => Promise<Response>,
): Promise<Response> {
  const result = await roots.fileFor(new URL(requestUrl))
  if ('file' in result) return readFile(result.file)
  return new Response(result.status === 403 ? 'Forbidden' : 'Not found', { status: result.status })
}

type SystemTarget = { kind: 'path'; value: string } | { kind: 'url'; value: string }

export async function systemTargetFor(raw: string, roots: ProjectRoots): Promise<SystemTarget | null> {
  if (classifyUrl(raw, roots) !== 'allow') return null
  const url = new URL(raw)
  if (url.protocol !== `${PROJECT_SCHEME}:`) return { kind: 'url', value: url.toString() }
  const result = await roots.fileFor(url)
  return 'file' in result ? { kind: 'path', value: result.file } : null
}

type PreventableEvent = { preventDefault: () => void }
type WebPreferences = Record<string, unknown>
type AttachParams = Record<string, unknown>

function applyAttachPolicy(webPreferences: WebPreferences, params: AttachParams, roots: ProjectRoots) {
  if (params.partition !== BROWSER_PARTITION) return false
  if (typeof params.src !== 'string' || classifyUrl(params.src, roots) !== 'allow') return false
  for (const key of STRIPPED_PREFERENCE_KEYS) delete webPreferences[key]
  Object.assign(webPreferences, {
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    zoomFactor: 1,
  })
  return true
}

type Listener = (...args: never[]) => void

export type GuestLike = {
  id: number
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(event: string, listener: Listener): unknown
  loadURL(url: string): unknown
  getURL(): string
  getTitle(): string
  copy(): void
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: { code: string }[]): Promise<unknown>
}

export type SelectionMenuItem = { label: string; click(): void }
export type SelectionMenuLabels = { addToChat: string; copy: string }

type ContextMenuParams = { selectionText: string; frame?: { parent: unknown } | null }

type BrowserHostLike = {
  on(event: string, listener: Listener): unknown
}

export type BrowserSessionLike = {
  getUserAgent(): string
  setUserAgent(userAgent: string): void
  setPermissionRequestHandler(handler: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void): void
  setPermissionCheckHandler(handler: () => boolean): void
  setDevicePermissionHandler(handler: () => boolean): void
  setDisplayMediaRequestHandler(handler: (request: unknown, callback: (streams: Record<string, never>) => void) => void): void
  protocol: { handle(scheme: string, handler: (request: { url: string }) => Promise<Response>): void }
}

type BrowserDeps = {
  host: BrowserHostLike
  session: BrowserSessionLike
  roots: ProjectRoots
  readFile: (file: string) => Promise<Response>
  notify: (event: string, payload: unknown) => void
  popupMenu: (items: SelectionMenuItem[]) => void
  menuLabels: () => SelectionMenuLabels | null
}

type KeyInput = {
  type: string
  key: string
  code: string
  control: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

function isAppShortcut(input: KeyInput) {
  return input.type === 'keyDown' && (input.control || input.meta) && !EDITING_KEYS.has(input.key.toLowerCase())
}

const SELECTION_PROBE_WORLD = 4242

async function touchesSensitiveField(guest: GuestLike) {
  try {
    return (await guest.executeJavaScriptInIsolatedWorld(SELECTION_PROBE_WORLD, [{ code: SELECTION_PROBE_SOURCE }])) !== false
  } catch (error) {
    console.warn('[browser] selection check failed', error)
    return true
  }
}

async function offerSelection(guest: GuestLike, params: ContextMenuParams, deps: BrowserDeps) {
  const capture = normalizeBrowserSelection({ text: params.selectionText, title: guest.getTitle(), url: guest.getURL() })
  if (!capture) return
  const inMainFrame = !params.frame?.parent
  const allowAdd = inMainFrame && !(await touchesSensitiveField(guest))
  const labels = deps.menuLabels()
  if (!labels) return
  deps.popupMenu([
    ...(allowAdd
      ? [{ label: labels.addToChat, click: () => deps.notify('browser-selection', { guestId: guest.id, ...capture }) }]
      : []),
    { label: labels.copy, click: () => guest.copy() },
  ])
}

function guardGuest(guest: GuestLike, deps: BrowserDeps) {
  const { roots, notify } = deps
  const allowMainFrame = (url: string) => {
    const verdict = classifyUrl(url, roots)
    if (verdict === 'external') notify('browser-external-request', { url })
    if (verdict === 'refuse') notify('browser-blocked', { guestId: guest.id, url, reason: 'scheme' })
    return verdict === 'allow'
  }
  const allowSubframe = (url: string) => /^(?:about|data|blob):/i.test(url) || classifyUrl(url, roots) === 'allow'

  guest.setWindowOpenHandler(({ url }) => {
    if (allowMainFrame(url)) guest.loadURL(url)
    return { action: 'deny' }
  })
  guest.on('will-navigate', ((event: PreventableEvent, url: string) => {
    if (!allowMainFrame(url)) event.preventDefault()
  }) as Listener)
  guest.on('will-redirect', ((event: PreventableEvent, url: string, _inPlace: boolean, isMainFrame: boolean) => {
    if (!(isMainFrame ? allowMainFrame(url) : allowSubframe(url))) event.preventDefault()
  }) as Listener)
  guest.on('will-frame-navigate', ((details: PreventableEvent & { url: string; isMainFrame: boolean }) => {
    if (!details.isMainFrame && !allowSubframe(details.url)) details.preventDefault()
  }) as Listener)
  guest.on('context-menu', ((_event: unknown, params: ContextMenuParams) => {
    void offerSelection(guest, params, deps)
  }) as Listener)
  guest.on('before-input-event', ((_event: PreventableEvent, input: KeyInput) => {
    if (!isAppShortcut(input)) return
    notify('browser-shortcut', {
      key: input.key,
      code: input.code,
      ctrlKey: input.control,
      metaKey: input.meta,
      shiftKey: input.shift,
      altKey: input.alt,
    })
  }) as Listener)
}

export function chromeUserAgent(userAgent: string) {
  return userAgent.replace(/ (?!(?:AppleWebKit|Chrome|Safari)\/)[^\s/()]+\/\S+/g, '')
}

export function installBrowser(deps: BrowserDeps) {
  const { host, session, roots, readFile } = deps
  session.setUserAgent(chromeUserAgent(session.getUserAgent()))
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.setDevicePermissionHandler(() => false)
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  session.protocol.handle(PROJECT_SCHEME, (request) => serveProjectRequest(request.url, roots, readFile))
  host.on('will-attach-webview', ((event: PreventableEvent, webPreferences: WebPreferences, params: AttachParams) => {
    if (!applyAttachPolicy(webPreferences, params, roots)) event.preventDefault()
  }) as Listener)
  host.on('did-attach-webview', ((_event: unknown, guest: GuestLike) => guardGuest(guest, deps)) as Listener)
}
