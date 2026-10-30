import { getProxyFetchOptions } from '../../../utils/proxy.js'
import { getManualNetworkProxyUrl, type NetworkSettings } from '../../services/networkSettings.js'
import { ModelContextWindowSchema, type DiscoveredProviderModel } from '../../types/provider.js'
import { deepseekSource } from './deepseek.js'
import { listedSource } from './listed.js'
import { lmstudioSource } from './lmstudio.js'
import { ollamaSource } from './ollama.js'
import { qwenSource } from './qwen.js'
import { warnLookupFailure, type ContextWindowRequest, type ContextWindowSource } from './source.js'

const CONTEXT_WINDOW_SOURCES: ContextWindowSource[] = [
  listedSource,
  ollamaSource,
  lmstudioSource,
  deepseekSource,
  qwenSource,
]

const LOOKUP_TIMEOUT_MS = 10_000

type FillContextWindowsInput = {
  baseUrl: string
  apiKey: string
  presetId?: string
  listed: Record<string, unknown>[]
  networkSettings: NetworkSettings
}

export async function fillContextWindows(models: DiscoveredProviderModel[], input: FillContextWindowsInput): Promise<void> {
  const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
  const proxy = getProxyFetchOptions({ proxyUrl: getManualNetworkProxyUrl(input.networkSettings) })
  const request: ContextWindowRequest = {
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
  for (const source of CONTEXT_WINDOW_SOURCES) {
    if (!source.matches(request)) continue
    let windows: Map<string, unknown>
    try {
      windows = await source.windows(request, modelIds)
    } catch (err) {
      warnLookupFailure(source.id, {}, err)
      continue
    }
    for (const model of models) {
      const contextWindow = ModelContextWindowSchema.safeParse(windows.get(model.id))
      if (contextWindow.success) model.contextWindow = contextWindow.data
    }
  }
}
