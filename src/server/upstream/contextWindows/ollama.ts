import pMap from 'p-map'
import { normalizeUpstreamBaseUrl } from '../baseUrl.js'
import { asRecord, visionCapability, warnLookupFailure, type ModelMetadataSource, type RawModelMetadata } from './source.js'

function contextLength(info: Record<string, unknown> | undefined): unknown {
  if (!info) return undefined
  const architecture = info['general.architecture']
  if (typeof architecture === 'string') return info[`${architecture}.context_length`]
  return Object.entries(info).find(([key]) => key.endsWith('.context_length'))?.[1]
}

function readShow(body: unknown): RawModelMetadata {
  const show = asRecord(body)
  return {
    contextWindow: contextLength(asRecord(show?.model_info)),
    image: visionCapability(show?.capabilities),
  }
}

export const ollamaSource: ModelMetadataSource = {
  id: 'ollama',
  matches: ({ presetId, listed }) => presetId === 'ollama' || listed.some((entry) => entry.owned_by === 'library'),
  metadata: async ({ baseUrl, fetchJson }, modelIds) => {
    const showUrl = `${normalizeUpstreamBaseUrl(baseUrl)}/api/show`
    const metadata = new Map<string, RawModelMetadata>()
    await pMap(modelIds, async (model) => {
      try {
        metadata.set(model, readShow(await fetchJson(showUrl, { method: 'POST', body: { model } })))
      } catch (err) {
        warnLookupFailure('ollama', { model }, err)
      }
    }, { concurrency: 4 })
    return metadata
  },
}
