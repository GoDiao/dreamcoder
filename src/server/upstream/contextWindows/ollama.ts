import pMap from 'p-map'
import { normalizeUpstreamBaseUrl } from '../baseUrl.js'
import { asRecord, warnLookupFailure, type ContextWindowSource } from './source.js'

function contextLength(body: unknown): unknown {
  const info = asRecord(asRecord(body)?.model_info)
  if (!info) return undefined
  const architecture = info['general.architecture']
  if (typeof architecture === 'string') return info[`${architecture}.context_length`]
  return Object.entries(info).find(([key]) => key.endsWith('.context_length'))?.[1]
}

export const ollamaSource: ContextWindowSource = {
  id: 'ollama',
  matches: ({ presetId, listed }) => presetId === 'ollama' || listed.some((entry) => entry.owned_by === 'library'),
  windows: async ({ baseUrl, fetchJson }, modelIds) => {
    const showUrl = `${normalizeUpstreamBaseUrl(baseUrl)}/api/show`
    const windows = new Map<string, unknown>()
    await pMap(modelIds, async (model) => {
      try {
        windows.set(model, contextLength(await fetchJson(showUrl, { method: 'POST', body: { model } })))
      } catch (err) {
        warnLookupFailure('ollama', { model }, err)
      }
    }, { concurrency: 4 })
    return windows
  },
}
