import * as fs from 'fs'
import * as path from 'path'

import { MODEL_CONTEXT_WINDOWS_ENV_KEY } from '../../utils/model/modelContextWindows.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import type {
  ApiFormat,
  ProviderModel,
  ProviderAuthStrategy,
  ProvidersIndex,
  SavedProvider,
} from '../types/provider.js'
import { normalizeUpstreamBaseUrl } from '../upstream/baseUrl.js'
import {
  ATTRIBUTION_HEADER_ENV_KEY,
  attributionHeaderEnvForModel,
} from './attributionHeaderPolicy.js'

export const MANAGED_PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  ATTRIBUTION_HEADER_ENV_KEY,
  MODEL_CONTEXT_WINDOWS_ENV_KEY,
  'DREAMCODER_OPENAI_OAUTH_PROVIDER',
  'OPENAI_CODEX_OAUTH_FILE',
] as const

const CUSTOM_PROVIDER_MODEL_CAPABILITIES = 'thinking,effort,adaptive_thinking,max_effort'
const AUTH_ENV_KEYS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isProviderModels(value: unknown): value is SavedProvider['models'] {
  return Array.isArray(value) && value.every((model) => (
    isRecord(model) &&
    typeof model.id === 'string' &&
    (model.name === undefined || typeof model.name === 'string')
  ))
}

function isSavedProvider(value: unknown): value is SavedProvider {
  if (!isRecord(value)) return false
  const runtimeKind = value.runtimeKind
  return (
    typeof value.id === 'string' &&
    typeof value.presetId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.apiKey === 'string' &&
    typeof value.baseUrl === 'string' &&
    (runtimeKind === undefined || runtimeKind === 'anthropic_compatible') &&
    isProviderModels(value.models)
  )
}

export function stripContextSuffix(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}

export function normalizeProviderModels(models: SavedProvider['models']): ProviderModel[] {
  const seen = new Set<string>()
  const normalized: ProviderModel[] = []
  for (const model of models) {
    const id = model.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = model.name?.trim()
    normalized.push({ id, ...(name ? { name } : {}) })
  }
  return normalized
}

export function getProviderDefaultModel(provider: SavedProvider): string {
  return normalizeProviderModels(provider.models)[0]?.id ?? ''
}

export function resolveProviderDefaultModel(
  provider: SavedProvider,
  managedSettings: Record<string, unknown>,
): string {
  const models = normalizeProviderModels(provider.models)
  const modelIds = new Set(models.map((model) => model.id))
  const explicitModel = typeof managedSettings.model === 'string'
    ? managedSettings.model.trim()
    : ''
  if (explicitModel && modelIds.has(stripContextSuffix(explicitModel))) {
    return explicitModel
  }

  const env = (managedSettings.env as Record<string, string> | undefined) ?? {}
  const envModel = typeof env.ANTHROPIC_MODEL === 'string' ? env.ANTHROPIC_MODEL.trim() : ''
  if (envModel && modelIds.has(stripContextSuffix(envModel))) {
    return envModel
  }
  return models[0]?.id ?? ''
}

export function normalizeSavedProvider(provider: SavedProvider): SavedProvider {
  const models = normalizeProviderModels(provider.models)
  const fastModel = provider.fastModel?.trim()
  return {
    ...provider,
    apiFormat: provider.apiFormat ?? 'anthropic',
    runtimeKind: provider.runtimeKind ?? 'anthropic_compatible',
    models,
    fastModel: fastModel && models.some((model) => model.id === fastModel)
      ? fastModel
      : undefined,
  }
}

export function normalizeProvidersIndex(value: unknown): ProvidersIndex | null {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return null
  }

  const { activeProviderId: legacyActiveProviderId, ...rest } = value
  const providers = value.providers
    .filter(isSavedProvider)
    .map((provider) => normalizeSavedProvider(provider))
  const rawActiveId =
    typeof value.activeId === 'string'
      ? value.activeId
      : typeof legacyActiveProviderId === 'string'
        ? legacyActiveProviderId
        : null
  const activeId = rawActiveId && providers.some((provider) => provider.id === rawActiveId)
    ? rawActiveId
    : null

  return {
    ...rest,
    schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : 1,
    activeId,
    providers,
  }
}

export function getPresetDefaultEnv(presetId: string): Record<string, string> {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.defaultEnv ?? {}
}

function omitAuthEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !AUTH_ENV_KEYS.has(key.toUpperCase())),
  )
}

export function getPresetAuthStrategy(presetId: string): ProviderAuthStrategy {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.authStrategy ?? 'auth_token'
}

function getPresetModelContextWindows(presetId: string): Record<string, number> {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.modelContextWindows ?? {}
}

export function resolveProviderApiKey(
  provider: SavedProvider,
  presetDefaultEnv: Record<string, string>,
): string {
  return provider.apiKey || presetDefaultEnv.ANTHROPIC_AUTH_TOKEN || presetDefaultEnv.ANTHROPIC_API_KEY || ''
}

export function buildProviderAuthEnv(
  provider: SavedProvider,
  presetDefaultEnv: Record<string, string>,
  needsProxy: boolean,
): Record<string, string> {
  if (needsProxy) {
    return { ANTHROPIC_API_KEY: 'proxy-managed' }
  }

  const strategy = provider.authStrategy ?? getPresetAuthStrategy(provider.presetId)
  const key = resolveProviderApiKey(provider, presetDefaultEnv)

  switch (strategy) {
    case 'api_key':
      return key ? { ANTHROPIC_API_KEY: key } : {}
    case 'auth_token':
    case 'auth_token_empty_api_key':
      return {
        ANTHROPIC_API_KEY: '',
        ...(key ? { ANTHROPIC_AUTH_TOKEN: key } : {}),
      }
    case 'dual_same_token':
      return key ? { ANTHROPIC_API_KEY: key, ANTHROPIC_AUTH_TOKEN: key } : {}
    case 'dual_dummy':
      return { ANTHROPIC_API_KEY: 'dummy', ANTHROPIC_AUTH_TOKEN: 'dummy' }
  }
}

export function getManagedEnvKeys(): string[] {
  const keys = new Set<string>(MANAGED_PROVIDER_ENV_KEYS)
  for (const preset of PROVIDER_PRESETS) {
    for (const key of Object.keys(preset.defaultEnv ?? {})) {
      keys.add(key)
    }
  }
  return [...keys]
}

export function buildProviderManagedEnv(
  provider: SavedProvider,
  options?: { proxyPath?: string; serverPort?: number; modelId?: string },
): Record<string, string> {
  const apiFormat: ApiFormat = provider.apiFormat ?? 'anthropic'
  const needsProxy = apiFormat !== 'anthropic'
  const proxyPath = options?.proxyPath ?? '/proxy'
  const serverPort = options?.serverPort ?? 3456
  const baseUrl = needsProxy
    ? `http://127.0.0.1:${serverPort}${proxyPath}`
    : normalizeUpstreamBaseUrl(provider.baseUrl)

  const models = normalizeProviderModels(provider.models)
  const selectedModel = options?.modelId?.trim() || models[0]?.id || ''
  const fastModel = provider.fastModel && models.some((model) => model.id === provider.fastModel)
    ? provider.fastModel
    : selectedModel
  const modelContextWindows = {
    ...getPresetModelContextWindows(provider.presetId),
    ...(provider.modelContextWindows ?? {}),
  }

  const presetDefaultEnv = getPresetDefaultEnv(provider.presetId)
  const customProviderCapabilityEnv =
    provider.presetId === 'custom'
      ? {
          ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: CUSTOM_PROVIDER_MODEL_CAPABILITIES,
          ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: CUSTOM_PROVIDER_MODEL_CAPABILITIES,
          ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: CUSTOM_PROVIDER_MODEL_CAPABILITIES,
        }
      : {}

  return {
    ...omitAuthEnv(presetDefaultEnv),
    ...customProviderCapabilityEnv,
    ...(provider.autoCompactWindow !== undefined && {
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(provider.autoCompactWindow),
    }),
    ...(Object.keys(modelContextWindows).length > 0 && {
      [MODEL_CONTEXT_WINDOWS_ENV_KEY]: JSON.stringify(modelContextWindows),
    }),
    ANTHROPIC_BASE_URL: baseUrl,
    ...buildProviderAuthEnv(provider, presetDefaultEnv, needsProxy),
    ANTHROPIC_MODEL: stripContextSuffix(selectedModel),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: stripContextSuffix(fastModel),
    ANTHROPIC_SMALL_FAST_MODEL: stripContextSuffix(fastModel),
    ANTHROPIC_DEFAULT_SONNET_MODEL: stripContextSuffix(selectedModel),
    ANTHROPIC_DEFAULT_OPUS_MODEL: stripContextSuffix(selectedModel),
    ...attributionHeaderEnvForModel(selectedModel),
  }
}

export function readActiveProviderManagedEnv(
  configDir: string,
  options?: { serverPort?: number },
): Record<string, string> | null {
  try {
    const raw = fs.readFileSync(path.join(configDir, 'dreamcoder', 'providers.json'), 'utf-8')
    const index = normalizeProvidersIndex(JSON.parse(raw))
    if (!index?.activeId) return null

    const provider = index.providers.find((entry) => entry.id === index.activeId)
    if (!provider) return null

    return buildProviderManagedEnv(provider, {
      serverPort: options?.serverPort,
    })
  } catch {
    return null
  }
}

export function mergeActiveProviderManagedEnv(
  settingsEnv: Record<string, string>,
  configDir: string,
  options?: { serverPort?: number },
): Record<string, string> {
  const activeProviderEnv = readActiveProviderManagedEnv(configDir, options)
  if (!activeProviderEnv) {
    return settingsEnv
  }

  const cleanedEnv = { ...settingsEnv }
  for (const key of getManagedEnvKeys()) {
    delete cleanedEnv[key]
  }
  return {
    ...cleanedEnv,
    ...activeProviderEnv,
  }
}
