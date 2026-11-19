import { getProxyFetchOptions } from '../../../utils/proxy.js'
import { getManualNetworkProxyUrl, type NetworkSettings } from '../../services/networkSettings.js'
import { validFields } from '../../services/modelRules/validFields.js'
import { DiscoveredModelSchema } from '../../types/modelRules.js'
import type { DiscoveredProviderModel } from '../../types/provider.js'
import { deepseekSource } from './deepseek.js'
import { listedSource } from './listed.js'
import { lmstudioSource } from './lmstudio.js'
import { openrouterSource } from './openrouter.js'
import { ollamaSource } from './ollama.js'
import { qwenSource } from './qwen.js'
import { warnLookupFailure, type ModelMetadataRequest, type ModelMetadataSource, type RawModelMetadata } from './source.js'

const MODEL_METADATA_SOURCES: ModelMetadataSource[] = [
  listedSource,
  openrouterSource,
  ollamaSource,
  lmstudioSource,
  deepseekSource,
  qwenSource,
]

const LOOKUP_TIMEOUT_MS = 10_000

type FillModelMetadataInput = {
  baseUrl: string
  apiKey: string
  presetId?: string
  listed: Record<string, unknown>[]
  networkSettings: NetworkSettings
}

export async function fillModelMetadata(models: DiscoveredProviderModel[], input: FillModelMetadataInput): Promise<void> {
  const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
  const proxy = getProxyFetchOptions({ proxyUrl: getManualNetworkProxyUrl(input.networkSettings) })
  const request: ModelMetadataRequest = {
    baseUrl: input.baseUrl,
    presetId: input.presetId,
    listed: input.listed,
    fetchJson: async (url, init = {}) => {
      const response = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        ...proxy,
        signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).pathname}`)
      return response.json()
    },
  }
  const modelIds = models.map((model) => model.id)
  for (const source of MODEL_METADATA_SOURCES) {
    if (!source.matches(request)) continue
    let metadata: Map<string, RawModelMetadata>
    try {
      metadata = await source.metadata(request, modelIds)
    } catch (err) {
      warnLookupFailure(source.id, {}, err)
      continue
    }
    for (const model of models) {
      const raw = metadata.get(model.id)
      if (raw) Object.assign(model, validFields(raw, DiscoveredModelSchema.shape))
    }
  }
}
