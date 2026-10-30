import type { UiPageSummary } from '@protocol'
import { themeColorScheme } from '../theme/colorScheme'
import type { ThemeMode } from '../types/settings'

export const UI_PAGE_MIN_HEIGHT = 48
export const UI_PAGE_MAX_HEIGHT = 640
export const UI_PAGE_INITIAL_HEIGHT = 120
export const UI_PAGE_READY_TIMEOUT_MS = 8000
const UI_PAGE_PROTOCOL_VERSION = '2026-01-26'
export const UI_PAGE_ERROR_MAX_LENGTH = 300

const ERROR_LEVELS = new Set(['error', 'critical', 'alert', 'emergency'])
const PAGE_ID_PATTERN = /^[0-9a-f]{24}$/

type UiPageMessage =
  | { kind: 'initialize'; id: number | string }
  | { kind: 'initialized' }
  | { kind: 'resize'; height: number }
  | { kind: 'error'; message: string }

type UiPageHostContext = {
  theme: 'light' | 'dark'
  displayMode: 'inline'
  containerDimensions: { maxHeight: number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseUiPageMessage(data: unknown): UiPageMessage | null {
  if (!isRecord(data) || data.jsonrpc !== '2.0' || typeof data.method !== 'string') return null
  const params = isRecord(data.params) ? data.params : {}
  const hasId = data.id !== undefined
  switch (data.method) {
    case 'ui/initialize':
      return typeof data.id === 'number' || typeof data.id === 'string' ? { kind: 'initialize', id: data.id } : null
    case 'ui/notifications/initialized':
      return hasId ? null : { kind: 'initialized' }
    case 'ui/notifications/size-changed':
      return !hasId && typeof params.height === 'number' && Number.isFinite(params.height) && params.height >= 0
        ? { kind: 'resize', height: params.height }
        : null
    case 'notifications/message':
      if (hasId || typeof params.level !== 'string' || !ERROR_LEVELS.has(params.level)) return null
      return { kind: 'error', message: String(params.data ?? '').slice(0, UI_PAGE_ERROR_MAX_LENGTH) }
    default:
      return null
  }
}

export function isFromFrame(event: Pick<MessageEvent, 'source'>, frameWindow: Window | null | undefined): boolean {
  return Boolean(frameWindow) && event.source === frameWindow
}

export function clampFrameHeight(height: number, maxHeight = UI_PAGE_MAX_HEIGHT): number {
  return Math.min(maxHeight, Math.max(UI_PAGE_MIN_HEIGHT, Math.ceil(height)))
}

export function buildHostContext(theme: ThemeMode): UiPageHostContext {
  return {
    theme: themeColorScheme(theme),
    displayMode: 'inline',
    containerDimensions: { maxHeight: UI_PAGE_MAX_HEIGHT },
  }
}

export function initializeResponse(id: number | string, context: UiPageHostContext) {
  return {
    jsonrpc: '2.0' as const,
    id,
    result: {
      protocolVersion: UI_PAGE_PROTOCOL_VERSION,
      hostInfo: { name: 'dreamcoder', version: '1' },
      hostCapabilities: {},
      hostContext: context,
    },
  }
}

export function hostContextChanged(context: UiPageHostContext) {
  return { jsonrpc: '2.0' as const, method: 'ui/notifications/host-context-changed', params: context }
}

export function uiPageUrl(baseUrl: string, sessionId: string, pageId: string, revision: number): string {
  return `${baseUrl.replace(/\/$/, '')}/ui-pages/${encodeURIComponent(sessionId)}/${pageId}/${revision}`
}

export function parseUiPageResult(content: unknown): UiPageSummary | null {
  const text = Array.isArray(content)
    ? content.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('')
    : content
  if (typeof text !== 'string') return null
  try {
    const value: unknown = JSON.parse(text)
    if (!isRecord(value)) return null
    const { pageId, revision, title } = value
    if (typeof pageId !== 'string' || !PAGE_ID_PATTERN.test(pageId)) return null
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return null
    return { pageId, revision, title: typeof title === 'string' && title ? title : pageId }
  } catch {
    return null
  }
}
