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
  normalizeSavedDecisionProvider,
} from './providerRuntimeEnv.js'
import { loadNetworkSettings } from './networkSettings.js'
import { fetchUpstreamModels, resolveUpstreamTarget, sendToUpstream, type UpstreamTarget } from '../upstream/client.js'
import { DECISION_PROVIDER_PRESETS } from '../config/decisionProviderPresets.js'
import type {
  SavedProvider,
  ProvidersIndex,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderInput,
  ProviderTestResult,
  ApiFormat,
  ProviderAuthStrategy,
  DiscoverProviderModelsInput,
  DiscoveredProviderModel,
  SavedDecisionProvider,
  CreateDecisionProviderInput,
  UpdateDecisionProviderInput,
  TestDecisionProviderInput,
  DiscoverDecisionProviderModelsInput,
} from '../types/provider.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const DEFAULT_INDEX: ProvidersIndex = {
  schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
  activeId: null,
  providers: [],
  activeDecisionProviderId: null,
  decisionProviders: [],
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

  async updateManagedSettings(settings: Record<string, unknown>): Promise<void> {
    await this.managedSettingsService.updateSettings((current) => ({
      settings: Object.assign({}, current, settings),
      result: undefined,
    }))
  }

  async listProviders(): Promise<{ providers: SavedProvider[]; activeId: string | null }> {
    const index = await this.readIndex()
    return { providers: index.providers, activeId: index.activeId }
  }

  async listDecisionProviders(): Promise<{
    providers: SavedDecisionProvider[]
    activeId: string | null
  }> {
    const index = await this.readIndex()
    return {
      providers: index.decisionProviders,
      activeId: index.activeDecisionProviderId,
    }
  }

  async getDecisionProvider(id: string): Promise<SavedDecisionProvider> {
    const index = await this.readIndex()
    const provider = index.decisionProviders.find((entry) => entry.id === id)
    if (!provider) throw ApiError.notFound(`Decision provider not found: ${id}`)
    return provider
  }

  async addDecisionProvider(
    input: CreateDecisionProviderInput,
  ): Promise<SavedDecisionProvider> {
    const index = await this.readIndex()
    const provider = normalizeSavedDecisionProvider({
      id: crypto.randomUUID(),
      ...input,
      deployment: 'hosted',
      models: normalizeProviderModels(input.models),
    })
    index.decisionProviders.push(provider)
    await this.writeIndex(index)
    return provider
  }

  async updateDecisionProvider(
    id: string,
    input: UpdateDecisionProviderInput,
  ): Promise<SavedDecisionProvider> {
    const index = await this.readIndex()
    const providerIndex = index.decisionProviders.findIndex((entry) => entry.id === id)
    if (providerIndex === -1) {
      throw ApiError.notFound(`Decision provider not found: ${id}`)
    }
    const provider = normalizeSavedDecisionProvider({
      ...index.decisionProviders[providerIndex],
      ...input,
      ...(input.models ? { models: normalizeProviderModels(input.models) } : {}),
    })
    index.decisionProviders[providerIndex] = provider
    await this.writeIndex(index)
    return provider
  }

  async deleteDecisionProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const providerIndex = index.decisionProviders.findIndex((entry) => entry.id === id)
    if (providerIndex === -1) {
      throw ApiError.notFound(`Decision provider not found: ${id}`)
    }
    if (index.activeDecisionProviderId === id) {
      throw ApiError.conflict('Cannot delete the active decision provider')
    }
    index.decisionProviders.splice(providerIndex, 1)
    await this.writeIndex(index)
  }

  async activateDecisionProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    if (!index.decisionProviders.some((entry) => entry.id === id)) {
      throw ApiError.notFound(`Decision provider not found: ${id}`)
    }
    index.activeDecisionProviderId = id
    await this.writeIndex(index)
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
      ...(input.modelContextWindows !== undefined && { modelContextWindows: input.modelContextWindows }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    this.assertFastModel(provider)

    index.providers.push(provider)
    await this.writeIndex(index)
    return provider
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    const existing = index.providers[idx]
    const updated: SavedProvider = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
      ...(input.authStrategy !== undefined && { authStrategy: input.authStrategy }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      ...(input.apiFormat !== undefined && { apiFormat: input.apiFormat }),
      ...(input.runtimeKind !== undefined && { runtimeKind: input.runtimeKind }),
      ...(input.models !== undefined && { models: normalizeProviderModels(input.models) }),
      ...(typeof input.fastModel === 'string' && { fastModel: input.fastModel }),
      ...(input.modelContextWindows !== undefined && input.modelContextWindows !== null && { modelContextWindows: input.modelContextWindows }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    if (input.modelContextWindows === null) {
      delete updated.modelContextWindows
    }
    if (input.fastModel === null || (input.fastModel === undefined && input.models !== undefined && !updated.models.some((model) => model.id === updated.fastModel))) {
      delete updated.fastModel
    }
    this.assertFastModel(updated)

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
    return this.buildManagedEnv(provider, {
      proxyPath: `/proxy/providers/${provider.id}`,
      modelId,
    })
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

  async getProviderForProxy(providerId?: string): Promise<UpstreamTarget | null> {
    if (providerId) {
      return resolveUpstreamTarget(await this.getProvider(providerId))
    }

    const index = await this.readIndex()
    if (!index.activeId) return null
    const provider = await this.getProvider(index.activeId).catch(() => null)
    return provider ? resolveUpstreamTarget(provider) : null
  }

  async testProvider(
    id: string,
    overrides?: { baseUrl?: string; modelId?: string; apiFormat?: ApiFormat; authStrategy?: ProviderAuthStrategy },
  ): Promise<ProviderTestResult> {
    const provider = await this.getProvider(id)
    const target = resolveUpstreamTarget(provider)
    return this.runProviderTest({
      ...target,
      baseUrl: overrides?.baseUrl || target.baseUrl,
      apiFormat: overrides?.apiFormat ?? target.apiFormat,
      authStrategy: overrides?.authStrategy ?? target.authStrategy,
    }, overrides?.modelId || getProviderDefaultModel(provider))
  }

  async discoverModels(input: DiscoverProviderModelsInput): Promise<DiscoveredProviderModel[]> {
    return this.fetchModels({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      apiFormat: input.apiFormat ?? 'anthropic',
      authStrategy: input.authStrategy ?? 'api_key',
    }, input.presetId)
  }

  async discoverDecisionModels(
    input: DiscoverDecisionProviderModelsInput,
  ): Promise<DiscoveredProviderModel[]> {
    const endpoint = decisionModelsEndpoint(input.baseUrl, input.apiFormat)
    const response = await fetch(endpoint, {
      headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {},
    })
    if (!response.ok) {
      throw new ApiError(502, `Model discovery failed with HTTP ${response.status}`, 'MODEL_DISCOVERY_FAILED')
    }
    const payload = await response.json() as unknown
    return filterDecisionModels(input, parseDecisionModels(payload))
  }

  async testDecisionProvider(
    id: string,
    modelId?: string,
  ): Promise<ProviderTestResult> {
    const provider = await this.getDecisionProvider(id)
    return this.testDecisionProviderConfig({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      apiFormat: provider.apiFormat,
      modelId: modelId || provider.models[0]?.id || '',
    })
  }

  async testDecisionProviderConfig(
    input: TestDecisionProviderInput,
  ): Promise<ProviderTestResult> {
    if (!input.modelId || (!input.apiKey && input.apiFormat !== 'ollama_chat')) {
      return {
        connectivity: {
          success: false,
          latencyMs: 0,
          error: 'Missing model or API key',
        },
      }
    }
    const { aiRequestTimeoutMs } = await loadNetworkSettings()
    const startedAt = Date.now()
    try {
      const response = await fetch(decisionRequestEndpoint(input.baseUrl, input.apiFormat), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
        },
        body: JSON.stringify(decisionTestBody(input.apiFormat, input.modelId)),
        signal: AbortSignal.timeout(aiRequestTimeoutMs),
      })
      const latencyMs = Date.now() - startedAt
      if (!response.ok) {
        return {
          connectivity: {
            success: false,
            latencyMs,
            error: `HTTP ${response.status}`,
            httpStatus: response.status,
            modelUsed: input.modelId,
          },
        }
      }
      const payload = await response.json() as unknown
      if (!isValidDecisionTestResponse(input.apiFormat, payload)) {
        return {
          connectivity: {
            success: false,
            latencyMs,
            error: 'Response did not match the selected API format',
            httpStatus: response.status,
            modelUsed: input.modelId,
          },
        }
      }
      return {
        connectivity: {
          success: true,
          latencyMs,
          httpStatus: response.status,
          modelUsed: input.modelId,
        },
      }
    } catch (error) {
      return {
        connectivity: {
          success: false,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          modelUsed: input.modelId,
        },
      }
    }
  }

  private async fetchModels(target: UpstreamTarget, presetId?: string): Promise<DiscoveredProviderModel[]> {
    const result = await fetchUpstreamModels(target, presetId)
    if (!result.ok) {
      const upstreamRejected = result.httpStatus !== undefined && result.httpStatus >= 400 && result.httpStatus < 500
      throw new ApiError(upstreamRejected ? 400 : 502, result.error, 'MODEL_DISCOVERY_FAILED')
    }
    return result.models
  }

  private assertFastModel(provider: SavedProvider): void {
    if (provider.fastModel && !provider.models.some((model) => model.id === provider.fastModel)) {
      throw ApiError.badRequest('Fast model must be one of the provider models')
    }
  }

  async testProviderConfig(input: TestProviderInput): Promise<ProviderTestResult> {
    return this.runProviderTest({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      apiFormat: input.apiFormat ?? 'anthropic',
      authStrategy: input.authStrategy ?? 'api_key',
    }, input.modelId)
  }

  private async runProviderTest(target: UpstreamTarget, modelId: string): Promise<ProviderTestResult> {
    if (!target.baseUrl || (!target.apiKey && target.authStrategy !== 'dual_dummy')) {
      return { connectivity: { success: false, latencyMs: 0, error: 'Missing baseUrl or apiKey' } }
    }

    const { aiRequestTimeoutMs } = await loadNetworkSettings()
    const start = Date.now()
    const result = await sendToUpstream(target, {
      model: modelId,
      max_tokens: 16,
      stream: true,
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
    }, { timeoutMs: aiRequestTimeoutMs })

    if (!result.ok) {
      return {
        connectivity: {
          success: false,
          latencyMs: Date.now() - start,
          error: result.error,
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

function appendEndpoint(baseUrl: string, pathName: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${pathName.replace(/^\/+/, '')}`
}

function decisionRequestEndpoint(baseUrl: string, apiFormat: TestDecisionProviderInput['apiFormat']): string {
  if (apiFormat === 'ollama_chat') return appendEndpoint(baseUrl, 'api/chat')
  if (apiFormat === 'openai_chat') return appendEndpoint(baseUrl, 'chat/completions')
  return appendEndpoint(baseUrl, 'decisions')
}

function decisionModelsEndpoint(baseUrl: string, apiFormat: TestDecisionProviderInput['apiFormat']): string {
  if (apiFormat === 'ollama_chat') return appendEndpoint(baseUrl, 'api/tags')
  if (apiFormat === 'openrouter_decisions') {
    return `${new URL(baseUrl).origin}/api/v1/models`
  }
  return appendEndpoint(baseUrl, 'models')
}

function decisionTestBody(
  apiFormat: TestDecisionProviderInput['apiFormat'],
  modelId: string,
): Record<string, unknown> {
  if (apiFormat === 'openai_decisions') {
    return {
      model: modelId,
      input: 'A connection test.',
      questions: [{
        type: 'predicate',
        name: 'connected',
        instructions: 'Return the probability that this is a connection test.',
      }],
    }
  }
  if (apiFormat === 'openrouter_decisions') {
    return {
      model: modelId,
      state: { situation: 'A connection test.' },
      questions: {
        connected: {
          type: 'noul',
          instructions: 'Is this a connection test?',
          criteria: [{ description: 'This is a connection test.' }],
        },
      },
    }
  }
  if (apiFormat === 'ollama_chat') {
    return {
      model: modelId,
      stream: false,
      messages: [{ role: 'user', content: 'Reply with ok.' }],
    }
  }
  return {
    model: modelId,
    max_tokens: 8,
    messages: [{ role: 'user', content: 'Reply with ok.' }],
  }
}

function parseDecisionModels(payload: unknown): DiscoveredProviderModel[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  const values = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : []
  const models = values.flatMap((value): DiscoveredProviderModel[] => {
    if (!value || typeof value !== 'object') return []
    const model = value as Record<string, unknown>
    const id = typeof model.id === 'string'
      ? model.id
      : typeof model.name === 'string'
        ? model.name
        : typeof model.model === 'string'
          ? model.model
          : ''
    if (!id) return []
    const name = typeof model.name === 'string' && model.name !== id
      ? model.name
      : undefined
    return [{ id, ...(name ? { name } : {}) }]
  })
  return normalizeProviderModels(models)
}

function filterDecisionModels(
  input: DiscoverDecisionProviderModelsInput,
  models: DiscoveredProviderModel[],
): DiscoveredProviderModel[] {
  const preset = DECISION_PROVIDER_PRESETS.find((entry) => entry.id === input.presetId)
  if (!preset || preset.models.length === 0 || preset.apiFormat !== input.apiFormat) return models
  const supportedIds = new Set(preset.models.map((model) => model.id))
  return models.filter((model) => supportedIds.has(model.id))
}

function isValidDecisionTestResponse(
  apiFormat: TestDecisionProviderInput['apiFormat'],
  payload: unknown,
): boolean {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  if (apiFormat === 'openai_decisions') {
    return Array.isArray(record.answers) && record.answers.some((value) => {
      if (!value || typeof value !== 'object') return false
      const answer = value as Record<string, unknown>
      return answer.name === 'connected' && typeof answer.probability === 'number'
    })
  }
  if (apiFormat === 'openrouter_decisions') {
    const answers = record.answers
    if (!answers || typeof answers !== 'object') return false
    const connected = (answers as Record<string, unknown>).connected
    return !!connected && typeof connected === 'object' &&
      typeof (connected as Record<string, unknown>).noul === 'number'
  }
  if (apiFormat === 'ollama_chat') {
    const message = record.message
    return !!message && typeof message === 'object' &&
      typeof (message as Record<string, unknown>).content === 'string'
  }
  return Array.isArray(record.choices) && record.choices.length > 0
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
