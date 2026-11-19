import { hostnameOf } from '../baseUrl.js'
import { asRecord, asRecords, inputModalities, metadataById, type ModelMetadataSource, type RawModelMetadata } from './source.js'

const QWEN_HOSTS = new Set(['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'])
const PAGE_SIZE = 100
const MAX_PAGES = 10

function readQwenModel(entry: Record<string, unknown>): RawModelMetadata {
  const info = asRecord(entry.model_info)
  return {
    contextWindow: info?.context_window,
    maxOutputTokens: info?.max_output_tokens,
    ...inputModalities(asRecord(entry.inference_metadata)?.request_modality),
  }
}

export const qwenSource: ModelMetadataSource = {
  id: 'qwen',
  matches: ({ baseUrl }) => QWEN_HOSTS.has(hostnameOf(baseUrl)),
  metadata: async ({ baseUrl, fetchJson }) => {
    const origin = new URL(baseUrl).origin
    const metadata = new Map<string, RawModelMetadata>()
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const output = asRecord(asRecord(await fetchJson(`${origin}/api/v1/models?page_no=${page}&page_size=${PAGE_SIZE}`))?.output)
      const entries = asRecords(output?.models)
      for (const [id, value] of metadataById(entries, 'model', readQwenModel)) metadata.set(id, value)
      if (entries.length === 0 || typeof output?.total !== 'number' || metadata.size >= output.total) break
    }
    return metadata
  },
}
