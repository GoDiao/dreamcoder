import { asRecord, asRecords, hostnameOf, windowsById, type ContextWindowSource } from './source.js'

export const deepseekSource: ContextWindowSource = {
  id: 'deepseek',
  matches: ({ baseUrl }) => hostnameOf(baseUrl) === 'api.deepseek.com',
  windows: async ({ baseUrl, fetchJson }) => {
    const body = asRecord(await fetchJson(`${new URL(baseUrl).origin}/models`))
    return windowsById(asRecords(body?.data), 'id', (entry) => entry.context_window)
  },
}
