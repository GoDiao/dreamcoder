import { asRecord, asRecords, hostnameOf, windowsById, type ContextWindowSource } from './source.js'

const QWEN_HOSTS = new Set(['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'])
const PAGE_SIZE = 100
const MAX_PAGES = 10

export const qwenSource: ContextWindowSource = {
  id: 'qwen',
  matches: ({ baseUrl }) => QWEN_HOSTS.has(hostnameOf(baseUrl)),
  windows: async ({ baseUrl, fetchJson }) => {
    const origin = new URL(baseUrl).origin
    const windows = new Map<string, unknown>()
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const output = asRecord(asRecord(await fetchJson(`${origin}/api/v1/models?page_no=${page}&page_size=${PAGE_SIZE}`))?.output)
      const entries = asRecords(output?.models)
      for (const [id, value] of windowsById(entries, 'model', (entry) => {
        const info = asRecord(entry.model_info)
        return info?.max_input_tokens ?? info?.context_window
      })) windows.set(id, value)
      if (entries.length === 0 || typeof output?.total !== 'number' || windows.size >= output.total) break
    }
    return windows
  },
}
