import { getNoProxy } from '../../utils/proxy.js'
import { SettingsService } from './settingsService.js'

export type NetworkProxyMode = 'system' | 'manual'

export type NetworkSettings = {
  aiRequestTimeoutMs: number
  proxy: {
    mode: NetworkProxyMode
    url: string
  }
}

export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 120_000
export const MIN_AI_REQUEST_TIMEOUT_MS = 5_000
export const MAX_AI_REQUEST_TIMEOUT_MS = 600_000

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1']

const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  aiRequestTimeoutMs: DEFAULT_AI_REQUEST_TIMEOUT_MS,
  proxy: {
    mode: 'system',
    url: '',
  },
}

function isNetworkProxyMode(value: unknown): value is NetworkProxyMode {
  return value === 'system' || value === 'manual'
}

function clampTimeoutMs(value: number): number {
  return Math.min(Math.max(value, MIN_AI_REQUEST_TIMEOUT_MS), MAX_AI_REQUEST_TIMEOUT_MS)
}

function parseTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_NETWORK_SETTINGS.aiRequestTimeoutMs
  }
  return clampTimeoutMs(Math.round(value))
}

function parseProxy(value: unknown): NetworkSettings['proxy'] {
  if (!value || typeof value !== 'object') {
    return DEFAULT_NETWORK_SETTINGS.proxy
  }

  const record = value as Record<string, unknown>
  return {
    mode: isNetworkProxyMode(record.mode) ? record.mode : DEFAULT_NETWORK_SETTINGS.proxy.mode,
    url: typeof record.url === 'string' ? record.url.trim() : '',
  }
}

export function normalizeNetworkSettings(settings: unknown): NetworkSettings {
  if (!settings || typeof settings !== 'object') {
    return DEFAULT_NETWORK_SETTINGS
  }

  const record = settings as Record<string, unknown>
  const rawNetwork = record.network
  const network = rawNetwork && typeof rawNetwork === 'object'
    ? rawNetwork as Record<string, unknown>
    : {}

  return {
    aiRequestTimeoutMs: parseTimeoutMs(network.aiRequestTimeoutMs),
    proxy: parseProxy(network.proxy),
  }
}

export function getManualNetworkProxyUrl(settings: NetworkSettings): string | undefined {
  if (settings.proxy.mode !== 'manual') return undefined
  const url = settings.proxy.url.trim()
  return url || undefined
}

export function buildNetworkEnvironment(
  settings: NetworkSettings,
  inheritedEnv: Record<string, string | undefined>,
): Record<string, string> {
  const timeout = String(settings.aiRequestTimeoutMs)
  return {
    API_TIMEOUT_MS: timeout,
    CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
    CLAUDE_STREAM_IDLE_TIMEOUT_MS: timeout,
    ...buildProxyEnvironment(settings, inheritedEnv),
  }
}

export function buildProxyEnvironment(
  settings: NetworkSettings,
  inheritedEnv: Record<string, string | undefined>,
): Record<string, string> {
  const proxyUrl = getManualNetworkProxyUrl(settings)
  if (!proxyUrl) return {}

  const noProxy = mergeNoProxy(getNoProxy(inheritedEnv))
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  }
}

function mergeNoProxy(inherited: string | undefined): string {
  if (inherited?.trim() === '*') return '*'
  const entries = (inherited ?? '').split(/[,\s]+/).filter(Boolean)
  return [...new Set([...entries, ...LOOPBACK_HOSTS])].join(',')
}

export async function loadNetworkSettings(): Promise<NetworkSettings> {
  const settings = await new SettingsService().getUserSettings()
  return normalizeNetworkSettings(settings)
}
