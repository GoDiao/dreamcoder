import { EFFORT_LEVELS } from '../../../utils/model/modelRules.js'
import { hostnameOf } from '../baseUrl.js'
import { asRecord, asRecords, metadataById, type ModelMetadataSource, type RawModelMetadata } from './source.js'

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const ANTHROPIC_ENDPOINT_PREFIX = 'anthropic/'

function openrouterListId(modelId: string): string {
  const id = modelId.replace(/\[[12]m\]$/i, '')
  const rest = id.slice(ANTHROPIC_ENDPOINT_PREFIX.length)
  return id.startsWith(ANTHROPIC_ENDPOINT_PREFIX) && rest.includes('/') ? rest : id
}

function readReasoning(entry: Record<string, unknown>): RawModelMetadata {
  const declared = asRecord(entry.reasoning)
  const parameters = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : []
  if (!declared && !parameters.includes('reasoning')) return {}
  const efforts = Array.isArray(declared?.supported_efforts) ? declared.supported_efforts : undefined
  const levels = efforts ? EFFORT_LEVELS.filter(level => efforts.includes(level)) : [...EFFORT_LEVELS]
  const canTurnOff = declared?.mandatory !== true
  const control = levels.length > 0
    ? canTurnOff ? 'toggle_effort' : 'effort'
    : canTurnOff ? 'toggle' : 'always'
  return { reasoning: { control, levels }, reasoningDialect: 'anthropic_adaptive' }
}

export const openrouterSource: ModelMetadataSource = {
  id: 'openrouter',
  matches: ({ baseUrl }) => hostnameOf(baseUrl) === 'openrouter.ai',
  metadata: async ({ fetchJson }, modelIds) => {
    const body = asRecord(await fetchJson(OPENROUTER_MODELS_URL))
    const byListId = metadataById(asRecords(body?.data), 'id', readReasoning)
    const metadata = new Map<string, RawModelMetadata>()
    for (const modelId of modelIds) {
      const entry = byListId.get(openrouterListId(modelId))
      if (entry) metadata.set(modelId, entry)
    }
    return metadata
  },
}
