import { z } from 'zod'

import { findLongestPrefix, normalizeModelId } from '../../../utils/model/modelRules.js'

const ModelsDevModelSchema = z.object({
  limit: z.object({ context: z.number().optional(), output: z.number().optional() }).optional(),
  reasoning: z.boolean().optional(),
  reasoning_options: z.array(z.object({ type: z.string(), values: z.array(z.string()).optional() })).optional(),
  modalities: z.object({ input: z.array(z.string()).optional() }).optional(),
  provider: z.object({ api: z.string().optional() }).optional(),
})
export type ModelsDevModel = z.infer<typeof ModelsDevModelSchema>

const ModelsDevProviderSchema = z.object({
  api: z.string().optional(),
  models: z.record(z.string(), z.unknown()),
})

export type ModelsDevCatalog = Record<string, { api?: string; models: Record<string, ModelsDevModel> }>

export type ModelsDevData = { fetchedAt: string; etag?: string; catalog: ModelsDevCatalog }

export const MODELS_DEV_URL = 'https://models.dev/api.json'

export const VENDOR_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'zai',
  'zhipuai',
  'moonshotai',
  'moonshotai-cn',
  'minimax',
  'minimax-cn',
  'mistral',
  'alibaba',
  'alibaba-cn',
] as const

function withoutEmptyFields(model: ModelsDevModel): ModelsDevModel {
  const { provider, ...rest } = model
  return provider?.api === undefined ? rest : { ...rest, provider: { api: provider.api } }
}

export function parseModelsDevCatalog(raw: unknown): ModelsDevCatalog {
  const providers = z.record(z.string(), z.unknown()).parse(raw)
  const catalog: ModelsDevCatalog = {}
  for (const [providerId, value] of Object.entries(providers)) {
    const provider = ModelsDevProviderSchema.safeParse(value)
    if (!provider.success) continue
    const models: Record<string, ModelsDevModel> = {}
    for (const [modelId, model] of Object.entries(provider.data.models)) {
      const parsed = ModelsDevModelSchema.safeParse(model)
      if (parsed.success) models[modelId] = withoutEmptyFields(parsed.data)
    }
    catalog[providerId] = { ...(provider.data.api !== undefined && { api: provider.data.api }), models }
  }
  if (Object.keys(catalog).length === 0) throw new Error('models.dev catalog has no providers')
  return catalog
}

export function parseModelsDevData(raw: unknown): ModelsDevData {
  const data = z
    .object({ fetchedAt: z.string().datetime(), etag: z.string().optional(), catalog: z.unknown() })
    .parse(raw)
  return { ...data, catalog: parseModelsDevCatalog(data.catalog) }
}

export function serializeModelsDevSnapshot(data: Pick<ModelsDevData, 'fetchedAt' | 'catalog'>): string {
  const providers = Object.entries(data.catalog).map(([providerId, provider]) => {
    const models = Object.entries(provider.models).map(
      ([modelId, model]) => `${JSON.stringify(modelId)}:${JSON.stringify(model)}`,
    )
    const api = provider.api === undefined ? '' : `"api":${JSON.stringify(provider.api)},`
    return `${JSON.stringify(providerId)}:{${api}"models":{\n${models.join(',\n')}\n}}`
  })
  return `{"fetchedAt":${JSON.stringify(data.fetchedAt)},"catalog":{\n${providers.join(',\n')}\n}}\n`
}

type UrlEntry = { providerId: string; host: string; segments: string[] }

export type ModelsDevIndex = {
  models: Map<string, Map<string, ModelsDevModel>>
  urls: UrlEntry[]
}

function parseUrl(url: string): { host: string; segments: string[] } | undefined {
  if (url.includes('${')) return undefined
  const parsed = URL.parse(url)
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return undefined
  return { host: parsed.hostname.toLowerCase(), segments: parsed.pathname.toLowerCase().split('/').filter(Boolean) }
}

export function buildModelsDevIndex(catalog: ModelsDevCatalog): ModelsDevIndex {
  const models = new Map<string, Map<string, ModelsDevModel>>()
  const urls: UrlEntry[] = []
  const addUrl = (providerId: string, url: string | undefined) => {
    const parsed = url === undefined ? undefined : parseUrl(url)
    if (parsed) urls.push({ providerId, ...parsed })
  }
  for (const [providerId, provider] of Object.entries(catalog)) {
    const byId = new Map<string, ModelsDevModel>()
    for (const [modelId, model] of Object.entries(provider.models)) {
      const key = normalizeModelId(modelId)
      if (!byId.has(key)) byId.set(key, model)
      addUrl(providerId, model.provider?.api)
    }
    models.set(providerId, byId)
    addUrl(providerId, provider.api)
  }
  return { models, urls }
}

function isSegmentPrefix(shorter: string[], longer: string[]): boolean {
  return shorter.every((segment, i) => longer[i] === segment)
}

function providersForBaseUrl(index: ModelsDevIndex, baseUrl: string): string[] {
  const target = parseUrl(baseUrl)
  if (!target) return []
  const sameHost = index.urls.filter(entry => entry.host === target.host)
  let best = -1
  let compatible: string[] = []
  for (const entry of sameHost) {
    const [shorter, longer] =
      entry.segments.length <= target.segments.length ? [entry.segments, target.segments] : [target.segments, entry.segments]
    if (!isSegmentPrefix(shorter, longer)) continue
    if (shorter.length > best) {
      best = shorter.length
      compatible = []
    }
    if (shorter.length === best) compatible.push(entry.providerId)
  }
  if (compatible.length > 0) return [...new Set(compatible)].sort()
  const hostProviders = [...new Set(sameHost.map(entry => entry.providerId))]
  return hostProviders.length === 1 ? hostProviders : []
}

const DATE_SUFFIX = /[-@](\d{8}|\d{4}-\d{2}-\d{2})$/

export function modelsDevCandidateKeys(modelId: string): string[] {
  const name = normalizeModelId(modelId)
  const keys = [name, name.replace(DATE_SUFFIX, '')]
  const slash = name.indexOf('/')
  if (slash >= 0) {
    const rest = name.slice(slash + 1)
    keys.push(rest, rest.replace(DATE_SUFFIX, ''))
  }
  return [...new Set(keys)]
}

type ModelsDevMatch = { id: string; model: ModelsDevModel }

function findExact(index: ModelsDevIndex, providers: string[], modelId: string): ModelsDevMatch | undefined {
  const keys = modelsDevCandidateKeys(modelId)
  for (const providerId of providers) {
    const models = index.models.get(providerId)
    for (const key of keys) {
      const model = models?.get(key)
      if (model) return { id: key, model }
    }
  }
  return undefined
}

function findPrefix(index: ModelsDevIndex, providers: string[], modelId: string): ModelsDevMatch | undefined {
  for (const providerId of providers) {
    const hit = findLongestPrefix(modelId, index.models.get(providerId) ?? [], ([key]) => key, false)
    if (hit) return { id: hit[0], model: hit[1] }
  }
  return undefined
}

export function lookupModelsDevModel(index: ModelsDevIndex, baseUrl: string, modelId: string): ModelsDevMatch | undefined {
  const providers = [...new Set([...providersForBaseUrl(index, baseUrl), ...VENDOR_PROVIDER_IDS])]
  return findExact(index, providers, modelId) ?? findPrefix(index, providers, modelId)
}
