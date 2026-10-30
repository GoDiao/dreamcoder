import { normalizeUpstreamBaseUrl } from '../baseUrl.js'
import { asRecord, asRecords, windowsById, type ContextWindowSource } from './source.js'

export const lmstudioSource: ContextWindowSource = {
  id: 'lmstudio',
  matches: ({ presetId }) => presetId === 'lmstudio',
  windows: async ({ baseUrl, fetchJson }) => {
    const body = asRecord(await fetchJson(`${normalizeUpstreamBaseUrl(baseUrl)}/api/v1/models`))
    return windowsById(asRecords(body?.models), 'key', (entry) => entry.max_context_length)
  },
}
