import { readUiPageRevision, type UiPageArtifact } from '../utils/uiPages.js'
import { UI_PAGE_ROUTE_PREFIX } from './h5AccessPolicy.js'
import { sessionService } from './services/sessionService.js'
import { contentTypeForPath, resolveDistAsset } from './staticH5.js'
import { UI_PAGE_BOOTSTRAP_HTML } from './uiPageBootstrap.js'

const UI_PAGE_READER_PREFIX = '/showai-reader/'
const READER_ENTRY = `${UI_PAGE_READER_PREFIX}reader.js`

export const UI_PAGE_CONTENT_SECURITY_POLICY = [
  'sandbox allow-scripts',
  "default-src 'none'",
  `script-src 'unsafe-inline' 'self'`,
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

const SESSION_ID_PATTERN = /^[0-9a-zA-Z_-]{1,64}$/
const ROUTE_PATTERN = /^\/ui-pages\/([^/]+)\/([^/]+)\/(\d+)$/

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': UI_PAGE_CONTENT_SECURITY_POLICY,
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

const PAGE_SCRIPT = `const { mount } = await import(${JSON.stringify(READER_ENTRY)});
const artifact = document.getElementById('page-data').textContent;
const root = document.getElementById('page');
let unmount = null;
function show() {
  const theme = document.documentElement.dataset.theme;
  if (unmount) unmount();
  unmount = mount(root, { artifact, options: theme ? { theme } : {} });
}
show();
window.addEventListener('dreamcoder:theme', show);`

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function uiPageDocument(artifact: UiPageArtifact): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${UI_PAGE_BOOTSTRAP_HTML}</head><body><div id="page"></div><script type="application/json" id="page-data">${scriptJson(artifact)}</script><script type="module">${PAGE_SCRIPT}</script></body></html>`
}

export function uiPageResponse(body: string, method = 'GET'): Response {
  return new Response(method === 'HEAD' ? null : body, { status: 200, headers: PAGE_HEADERS })
}

export function isUiPageRequest(url: URL): boolean {
  return url.pathname.startsWith(UI_PAGE_ROUTE_PREFIX) || url.pathname.startsWith(UI_PAGE_READER_PREFIX)
}

export async function handleUiPageRequest(req: Request, url: URL): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  if (url.pathname.startsWith(UI_PAGE_READER_PREFIX)) return readerAsset(req, url)
  const match = ROUTE_PATTERN.exec(url.pathname)
  if (!match || !SESSION_ID_PATTERN.test(match[1]!)) return notFound()
  const sessionDir = await sessionService.getSessionDataDir(match[1]!)
  if (!sessionDir) return notFound()
  const page = await readUiPageRevision(sessionDir, match[2]!, Number(match[3]))
  if (!page) return notFound()
  return uiPageResponse(uiPageDocument(page.artifact), req.method)
}

async function readerAsset(req: Request, url: URL): Promise<Response> {
  const file = await resolveDistAsset(url.pathname)
  if (!file) return notFound()
  return new Response(req.method === 'HEAD' ? null : Bun.file(file), {
    status: 200,
    headers: {
      'Content-Type': contentTypeForPath(file),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function notFound(): Response {
  return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
}
