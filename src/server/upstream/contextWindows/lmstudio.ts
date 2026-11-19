import { normalizeUpstreamBaseUrl } from '../baseUrl.js'
import { asRecord, asRecords, metadataById, visionCapability, type ModelMetadataSource } from './source.js'

export const lmstudioSource: ModelMetadataSource = {
  id: 'lmstudio',
  matches: ({ presetId }) => presetId === 'lmstudio',
  metadata: async ({ baseUrl, fetchJson }) => {
    const body = asRecord(await fetchJson(`${normalizeUpstreamBaseUrl(baseUrl)}/api/v1/models`))
    return metadataById(asRecords(body?.models), 'key', (entry) => ({
      contextWindow: entry.max_context_length,
      image: visionCapability(entry.capabilities),
    }))
  },
}
