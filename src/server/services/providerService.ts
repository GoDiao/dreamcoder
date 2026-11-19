import * as fs from 'fs/promises'
import * as path from 'path'
import { ApiError } from '../middleware/errorHandler.js'
import { readRecoverableJsonFile } from './recoverableJsonFile.js'
import { ManagedSettingsService } from './managedSettingsService.js'
import {
  CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
  ensurePersistentStorageUpgraded,
} from './persistentStorageMigrations.js'
import {
  buildProviderAuthEnv,
  buildProviderManagedEnv,
  getManagedEnvKeys,
  getProviderDefaultModel,
  getPresetDefaultEnv,
  normalizeProviderModels,
  normalizeProvidersIndex,
} from './providerRuntimeEnv.js'
import { loadNetworkSettings } from './networkSettings.js'
import { SettingsService } from './settingsService.js'
import { auxiliaryRequestFields } from './modelRules/auxiliaryRequest.js'
import { buildCliModelRulesEnv, buildResolvedModelsView } from './modelRules/cliModelRulesEnv.js'
import { isOfficialAnthropicProvider } from './modelRules/officialAnthropicProvider.js'
import type { ModelRulesProvider } from './modelRules/resolveModelRules.js'
import {
  fetchUpstreamModels,
  resolveUpstreamTarget,
  sendToUpstream,
  type ProxyUpstream,
  type UpstreamTarget,
} from '../upstream/client.js'
import { describeFailure } from '../upstream/upstreamError.js'
import {
  dialectFitsFormat,
  type DiscoveredModel,
} from '../types/modelRules.js'
import type {
  SavedProvider,
  ProviderListItem,
  ProvidersIndex,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderInput,
  ProviderTestResult,
  ApiFormat,
  ProviderAuthStrategy,
  DiscoverProviderModelsInput,
  DiscoveredProviderModel,
  ProviderSaveResult,
} from '../types/provider.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { MODEL_RULES_ENV_KEY, normalizeModelId } from '../../utils/model/modelRules.js'

const SAVE_DISCOVERY_TIMEOUT_MS = 10_000

const DEFAULT_INDEX: ProvidersIndex = {
  schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
  activeId: null,
  providers: [],
}

function withoutStaleDiscovery(existing: SavedProvider, next: SavedProvider): SavedProvider {
  if (existing.baseUrl === next.baseUrl && existing.apiFormat === next.apiFormat) return next
  const { discoveredModels: _discoveredModels, discoveredAt: _discoveredAt, ...rest } = next
  return rest
}

function discoveredModelsFor(provider: SavedProvider, models: DiscoveredProviderModel[]): Record<string, DiscoveredModel> {
  const providerModelIds = new Set(provider.models.map((model) => normalizeModelId(model.id)))
  const discovered: Record<string, DiscoveredModel> = {}
  for (const { id, name: _name, ...metadata } of models) {
    if (providerModelIds.has(normalizeModelId(id)) && Object.keys(metadata).length > 0) discovered[id] = metadata
  }
  return discovered
}

function discoveryWarning(provider: SavedProvider, error: string): ProviderSaveResult {
  console.warn('[providers] Model metadata refresh failed', { providerId: provider.id, error })
  return { provider, modelDiscovery: { ok: false, error } }
}

export class ProviderService {
  private static serverPort = 3456
  private managedSettingsService = new ManagedSettingsService()

  static setServerPort(port: number): void {
    ProviderService.serverPort = port
  }

  static getServerPort(): number {
    return ProviderService.serverPort
  }
  private getConfigDir(): string {
    return getClaudeConfigHomeDir()
  }

  private getDreamcoderDir(): string {
    return path.join(this.getConfigDir(), 'dreamcoder')
  }

  private getIndexPath(): string {
    return path.join(this.getDreamcoderDir(), 'providers.json')
  }

  private async readIndex(): Promise<ProvidersIndex> {
    await ensurePersistentStorageUpgraded()
    return readRecoverableJsonFile({
      filePath: this.getIndexPath(),
      label: 'providers index',
      defaultValue: DEFAULT_INDEX,
      normalize: normalizeProvidersIndex,
    })
  }

  private async writeIndex(index: ProvidersIndex): Promise<void> {
    const filePath = this.getIndexPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(index, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write providers index: ${err}`)
    }
  }

  private async readSettings(): Promise<Record<string, unknown>> {
    return this.managedSettingsService.readSettings()
  }

  async getManagedSettings(): Promise<Record<string, unknown>> {
    return this.readSettings()
  }

  async listProviders(): Promise<{ providers: SavedProvider[]; activeId: string | null }> {
    const index = await this.readIndex()
    return { providers: index.providers, activeId: index.activeId }
  }

  async listProviderViews(): Promise<{ providers: ProviderListItem[]; activeId: string | null }> {
    const { providers, activeId } = await this.listProviders()
    return {
      activeId,
      providers: providers.map((provider) => {
        const resolvedModels = buildResolvedModelsView(provider, provider.models.map((model) => model.id))
        return resolvedModels ? { ...provider, resolvedModels } : provider
      }),
    }
  }

  async getProvider(id: string): Promise<SavedProvider> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)
    return provider
  }

  async addProvider(input: CreateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()

    const provider: SavedProvider = {
      id: crypto.randomUUID(),
      presetId: input.presetId,
      name: input.name,
      apiKey: input.apiKey,
      ...(input.authStrategy !== undefined && { authStrategy: input.authStrategy }),
      baseUrl: input.baseUrl,
      apiFormat: input.apiFormat ?? 'anthropic',
      runtimeKind: input.runtimeKind ?? 'anthropic_compatible',
      models: normalizeProviderModels(input.models),
      ...(input.fastModel !== undefined && { fastModel: input.fastModel }),
      ...(input.modelOverrides !== undefined && { modelOverrides: input.modelOverrides }),
      ...(input.extraHeaders !== undefined && { extraHeaders: input.extraHeaders }),
      ...(input.queryParams !== undefined && { queryParams: input.queryParams }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    this.assertFastModel(provider)
    this.assertRequestOptions(provider)
    this.assertModelOverrides(provider)

    index.providers.push(provider)
    await this.writeIndex(index)
    return provider
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    const existing = index.providers[idx]
    const updated: SavedProvider = withoutStaleDiscovery(existing, {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
      ...(input.authStrategy !== undefined && { authStrategy: input.authStrategy }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      ...(input.apiFormat !== undefined && { apiFormat: input.apiFormat }),
      ...(input.runtimeKind !== undefined && { runtimeKind: input.runtimeKind }),
      ...(input.models !== undefined && { models: normalizeProviderModels(input.models) }),
      ...(typeof input.fastModel === 'string' && { fastModel: input.fastModel }),
      ...(input.modelOverrides !== undefined && { modelOverrides: input.modelOverrides }),
      ...(input.extraHeaders != null && { extraHeaders: input.extraHeaders }),
      ...(input.queryParams != null && { queryParams: input.queryParams }),
      ...(input.notes !== undefined && { notes: input.notes }),
    })
    if (input.extraHeaders === null) delete updated.extraHeaders
    if (input.queryParams === null) delete updated.queryParams
    if (input.fastModel === null || (input.fastModel === undefined && input.models !== undefined && !updated.models.some((model) => model.id === updated.fastModel))) {
      delete updated.fastModel
    }
    this.assertFastModel(updated)
    this.assertRequestOptions(updated)
    this.assertModelOverrides(updated)

    index.providers[idx] = updated
    await this.writeIndex(index)

    if (index.activeId === id) {
      await this.syncToSettings(updated)
    }

    return updated
  }

  async deleteProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    if (index.activeId === id) {
      throw ApiError.conflict('Cannot delete the active provider. Switch to another provider first.')
    }

    index.providers.splice(idx, 1)
    await this.writeIndex(index)
  }

  async activateProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)

    index.activeId = id
    await this.writeIndex(index)

    await this.syncToSettings(provider)
  }

  private buildManagedEnv(
    provider: SavedProvider,
    options?: { proxyPath?: string; modelId?: string },
  ): Record<string, string> {
    return buildProviderManagedEnv(provider, {
      proxyPath: options?.proxyPath,
      modelId: options?.modelId,
      serverPort: ProviderService.serverPort,
    })
  }

  async getProviderRuntimeEnv(id: string, modelId?: string): Promise<Record<string, string>> {
    const provider = await this.getProvider(id)
    const env = this.buildManagedEnv(provider, {
      proxyPath: `/proxy/providers/${provider.id}`,
      modelId,
    })
    if (isOfficialAnthropicProvider(provider)) return env

    const { effort } = await new SettingsService().getUserSettings()
    const modelIds = [
      env.ANTHROPIC_MODEL,
      env.ANTHROPIC_SMALL_FAST_MODEL,
      ...provider.models.map((model) => model.id),
    ].filter((model): model is string => !!model)
    return {
      ...env,
      [MODEL_RULES_ENV_KEY]: JSON.stringify(buildCliModelRulesEnv(provider, modelIds, effort)),
    }
  }

  private async syncToSettings(provider: SavedProvider): Promise<void> {
    await this.managedSettingsService.updateSettings((settings) => {
      const existingEnv = (settings.env as Record<string, string>) || {}
      const cleanedEnv = { ...existingEnv }

      for (const key of getManagedEnvKeys()) {
        delete cleanedEnv[key]
      }

      return {
        settings: {
          ...settings,
          env: {
            ...cleanedEnv,
            ...this.buildManagedEnv(provider),
          },
        },
        result: undefined,
      }
    })
  }

  async checkAuthStatus(): Promise<{
    hasAuth: boolean
    source: 'dreamcoder-provider' | 'original-settings' | 'env' | 'none'
    activeProvider?: string
  }> {
    const index = await this.readIndex()
    if (index.activeId) {
      const provider = index.providers.find(p => p.id === index.activeId)
      if (provider) {
        const presetDefaultEnv = getPresetDefaultEnv(provider.presetId)
        const needsProxy = provider.apiFormat != null && provider.apiFormat !== 'anthropic'
        const authEnv = buildProviderAuthEnv(provider, presetDefaultEnv, needsProxy)
        if (Object.values(authEnv).some(value => value.length > 0)) {
          return { hasAuth: true, source: 'dreamcoder-provider', activeProvider: provider.name }
        }
      }
    }

    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      return { hasAuth: true, source: 'env' }
    }

    try {
      const originalPath = path.join(this.getConfigDir(), 'settings.json')
      const raw = await fs.readFile(originalPath, 'utf-8')
      const settings = JSON.parse(raw) as { env?: Record<string, string> }
      const env = settings.env ?? {}
      if (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY) {
        return { hasAuth: true, source: 'original-settings' }
      }
    } catch {
    }

    return { hasAuth: false, source: 'none' }
  }

  async getProviderForProxy(providerId?: string): Promise<ProxyUpstream | null> {
    if (providerId) {
      const provider = await this.getProvider(providerId)
      return { target: resolveUpstreamTarget(provider), provider }
    }

    const index = await this.readIndex()
    if (!index.activeId) return null
    const provider = await this.getProvider(index.activeId).catch(() => null)
    return provider ? { target: resolveUpstreamTarget(provider), provider } : null
  }

  async testProvider(
    id: string,
    overrides?: { baseUrl?: string; modelId?: string; apiFormat?: ApiFormat; authStrategy?: ProviderAuthStrategy },
  ): Promise<ProviderTestResult> {
    const saved = await this.getProvider(id)
    const provider = withoutStaleDiscovery(saved, {
      ...saved,
      ...(overrides?.baseUrl && { baseUrl: overrides.baseUrl }),
      ...(overrides?.apiFormat && { apiFormat: overrides.apiFormat }),
      ...(overrides?.authStrategy && { authStrategy: overrides.authStrategy }),
    })
    return this.runProviderTest(
      resolveUpstreamTarget(provider),
      provider,
      overrides?.modelId || getProviderDefaultModel(provider),
    )
  }

  async discoverModels(input: DiscoverProviderModelsInput): Promise<DiscoveredProviderModel[]> {
    return this.fetchModels({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      apiFormat: input.apiFormat ?? 'anthropic',
      authStrategy: input.authStrategy ?? 'api_key',
      ...(input.extraHeaders && { extraHeaders: input.extraHeaders }),
      ...(input.queryParams && { queryParams: input.queryParams }),
    }, input.presetId)
  }

  async refreshDiscoveredModels(id: string): Promise<ProviderSaveResult> {
    const provider = await this.getProvider(id)
    let result: Awaited<ReturnType<typeof fetchUpstreamModels>>
    try {
      result = await fetchUpstreamModels(resolveUpstreamTarget(provider), provider.presetId, SAVE_DISCOVERY_TIMEOUT_MS)
    } catch (error) {
      return discoveryWarning(provider, error instanceof Error ? error.message : String(error))
    }
    if (!result.ok) return discoveryWarning(provider, describeFailure(result))

    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)
    const { discoveredModels: _previous, ...current } = index.providers[idx]!
    const discoveredModels = discoveredModelsFor(current, result.models)
    const updated: SavedProvider = {
      ...current,
      ...(Object.keys(discoveredModels).length > 0 && { discoveredModels }),
      discoveredAt: new Date().toISOString(),
    }
    index.providers[idx] = updated
    await this.writeIndex(index)
    return { provider: updated }
  }

  private async fetchModels(target: UpstreamTarget, presetId?: string): Promise<DiscoveredProviderModel[]> {
    const result = await fetchUpstreamModels(target, presetId)
    if (!result.ok) {
      const upstreamRejected = result.httpStatus !== undefined && result.httpStatus >= 400 && result.httpStatus < 500
      throw new ApiError(upstreamRejected ? 400 : 502, describeFailure(result), 'MODEL_DISCOVERY_FAILED')
    }
    return result.models
  }

  private assertRequestOptions(provider: SavedProvider): void {
    const hasOptions = Object.keys(provider.extraHeaders ?? {}).length > 0
      || Object.keys(provider.queryParams ?? {}).length > 0
    if (hasOptions && provider.apiFormat === 'anthropic') {
      throw ApiError.badRequest('Extra headers and query parameters only apply to OpenAI-format providers')
    }
  }

  private assertModelOverrides(provider: SavedProvider): void {
    const seen = new Map<string, string>()
    for (const [modelId, override] of Object.entries(provider.modelOverrides ?? {})) {
      const key = normalizeModelId(modelId)
      const previous = seen.get(key)
      if (previous !== undefined) {
        throw new ApiError(400, `Model overrides for ${previous} and ${modelId} name the same model`, 'MODEL_OVERRIDE_DUPLICATE')
      }
      seen.set(key, modelId)
      if (provider.apiFormat === 'anthropic' && Object.keys(override.extraBody ?? {}).length > 0) {
        throw new ApiError(400, `Extra body fields for ${modelId} only apply to OpenAI-format providers`, 'MODEL_OVERRIDE_EXTRA_BODY_ANTHROPIC')
      }
      if (override.reasoningDialect && !dialectFitsFormat(override.reasoningDialect, provider.apiFormat)) {
        throw new ApiError(
          400,
          `Reasoning dialect ${override.reasoningDialect} for ${modelId} does not fit API format ${provider.apiFormat}`,
          'MODEL_OVERRIDE_DIALECT_MISMATCH',
        )
      }
    }
  }

  private assertFastModel(provider: SavedProvider): void {
    if (provider.fastModel && !provider.models.some((model) => model.id === provider.fastModel)) {
      throw ApiError.badRequest('Fast model must be one of the provider models')
    }
  }

  async testProviderConfig(input: TestProviderInput): Promise<ProviderTestResult> {
    const apiFormat = input.apiFormat ?? 'anthropic'
    return this.runProviderTest({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      apiFormat,
      authStrategy: input.authStrategy ?? 'api_key',
    }, { baseUrl: input.baseUrl, apiFormat }, input.modelId)
  }

  private async runProviderTest(
    target: UpstreamTarget,
    provider: ModelRulesProvider,
    modelId: string,
  ): Promise<ProviderTestResult> {
    if (!target.baseUrl || (!target.apiKey && target.authStrategy !== 'dual_dummy')) {
      return { connectivity: { success: false, latencyMs: 0, error: 'Missing baseUrl or apiKey' } }
    }

    const { aiRequestTimeoutMs } = await loadNetworkSettings()
    const start = Date.now()
    const result = await sendToUpstream({ target, provider }, {
      model: modelId,
      max_tokens: 16,
      stream: true,
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      ...auxiliaryRequestFields(provider, modelId),
    }, { timeoutMs: aiRequestTimeoutMs })

    if (!result.ok) {
      return {
        connectivity: {
          success: false,
          latencyMs: Date.now() - start,
          error: describeFailure(result),
          modelUsed: modelId,
          httpStatus: result.httpStatus,
        },
      }
    }

    const outcome = 'stream' in result
      ? await readAnthropicStream(result.stream, Math.max(aiRequestTimeoutMs - (Date.now() - start), 0))
      : { ok: true as const, model: result.message.model }
    const latencyMs = Date.now() - start

    if (!outcome.ok) {
      return {
        connectivity: { success: false, latencyMs, error: outcome.error, modelUsed: modelId, httpStatus: result.httpStatus },
      }
    }
    return {
      connectivity: { success: true, latencyMs, modelUsed: outcome.model || modelId, httpStatus: result.httpStatus },
    }
  }
}

async function readAnthropicStream(
  stream: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<{ ok: true; model?: string } | { ok: false; error: string }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let model: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Request timed out (${Math.round(timeoutMs / 1000)}s)`)), timeoutMs)
  })

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout])
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const event = parseSseData(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (!event) continue
        if (event.type === 'message_start') {
          const message = event.message as Record<string, unknown> | undefined
          model = typeof message?.model === 'string' ? message.model : model
        } else if (event.type === 'error') {
          const error = event.error as Record<string, unknown> | undefined
          return { ok: false, error: (error?.message as string) || 'Upstream stream returned an error' }
        } else if (event.type === 'message_stop') {
          return { ok: true, model }
        }
      }
    }
    return { ok: false, error: 'Stream ended before message_stop — not a valid streaming endpoint' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
    reader.cancel().catch(() => {})
  }
}

function parseSseData(block: string): Record<string, unknown> | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
  if (!data || data === '[DONE]') return null
  try {
    const parsed = JSON.parse(data)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}
