import { hostnameOf } from '../baseUrl.js'
import { readListedMetadata } from './listed.js'
import { asRecord, asRecords, metadataById, type ModelMetadataSource } from './source.js'

export const deepseekSource: ModelMetadataSource = {
  id: 'deepseek',
  matches: ({ baseUrl }) => hostnameOf(baseUrl) === 'api.deepseek.com',
  metadata: async ({ baseUrl, fetchJson }) => {
    const body = asRecord(await fetchJson(`${new URL(baseUrl).origin}/models`))
    return metadataById(asRecords(body?.data), 'id', readListedMetadata)
  },
}
