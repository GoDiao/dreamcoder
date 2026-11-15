import { BROWSER_MCP_PATH, WEB_CLONE_BROWSER_PATH } from './browserHost/names.js'
import { BROWSER_HOST_PATH } from './browserHost/protocol.js'
import { isLocalNonBrowserRequest, isLoopbackHost } from './h5AccessPolicy.js'
import { requireH5Token } from './middleware/auth.js'

export const REMOTE_SERVING_ENV = 'SERVER_REMOTE_SERVING'

const FORWARDING_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'via']
const H5_ACCESS_PATH = '/api/h5-access'
const H5_VERIFY_PATH = '/api/h5-access/verify'
const WEB_CLONE_PREFIX = `${WEB_CLONE_BROWSER_PATH}/`

export type RemoteServingRequest = {
  request: Request
  url: URL
  clientAddress: string | null
  h5Enabled: boolean
}

export function isRemoteServingRequested(flagPresent: boolean): boolean {
  const value = process.env[REMOTE_SERVING_ENV]
  if (value !== undefined && value !== '' && value !== '0' && value !== '1') {
    throw new Error(`${REMOTE_SERVING_ENV} must be 1 or 0, not "${value}".`)
  }
  return flagPresent || value === '1'
}

export function assertRemoteServingStartup({ host, authRequired }: { host: string; authRequired: boolean }): void {
  if (!isLoopbackHost(host)) {
    throw new Error(`Remote-serving mode listens on a loopback address only, not "${host}". Reach it through an SSH tunnel.`)
  }
  if (authRequired) {
    throw new Error('Remote-serving mode cannot be combined with --auth-required or SERVER_AUTH_REQUIRED.')
  }
}

function hasLoopbackHost(request: Request): boolean {
  const host = request.headers.get('host')
  if (!host || !/^[^\s@/\\?#]+$/.test(host)) return false
  try {
    return isLoopbackHost(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}

export function refuseUnlessLoopbackHost(request: Request): Response | null {
  return hasLoopbackHost(request)
    ? null
    : refuse(403, 'Remote-serving mode only answers requests addressed to a loopback host name.')
}

function refuse(status: 403 | 503, message: string): Response {
  return Response.json({ error: status === 403 ? 'Forbidden' : 'Service Unavailable', message }, { status })
}

function isBrowserHostPath(pathname: string): boolean {
  return pathname === BROWSER_HOST_PATH ||
    pathname === BROWSER_MCP_PATH ||
    pathname === WEB_CLONE_BROWSER_PATH ||
    pathname.startsWith(WEB_CLONE_PREFIX)
}

function isOperatorPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname.startsWith('/ws/')
}

export async function guardRemoteServing({ request, url, clientAddress, h5Enabled }: RemoteServingRequest): Promise<Response | null> {
  if (FORWARDING_HEADERS.some((name) => request.headers.has(name))) {
    return refuse(403, 'Remote-serving mode does not accept proxied requests.')
  }

  const { pathname } = url

  if (pathname === '/health') return null

  if (pathname === '/terminal' || isBrowserHostPath(pathname)) {
    return refuse(403, 'This endpoint is not available in remote-serving mode.')
  }

  if (pathname.startsWith('/sdk/') || pathname.startsWith('/proxy/')) {
    return isLocalNonBrowserRequest(clientAddress, request.headers.get('Origin'))
      ? null
      : refuse(403, 'This endpoint only accepts local, non-browser callers.')
  }

  if (pathname.startsWith(H5_ACCESS_PATH) && pathname !== H5_VERIFY_PATH) {
    return refuse(403, 'H5 access settings cannot be changed in remote-serving mode.')
  }

  if (isOperatorPath(pathname)) {
    if (request.method === 'OPTIONS') return null
    if (!h5Enabled) {
      return refuse(503, 'Remote-serving mode needs H5 access to be enabled with an access token.')
    }
    return requireH5Token(request, pathname.startsWith('/ws/') ? url.searchParams.get('token') : null)
  }

  if (request.method === 'GET' || request.method === 'HEAD') return null

  return refuse(403, 'This request is not accepted in remote-serving mode.')
}
