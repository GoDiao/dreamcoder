import { EFFORT_LEVELS, ModelContextWindowSchema } from '../../../utils/model/modelRules.js'
import type { ModelRuleFields } from '../../types/modelRules.js'
import type { ModelsDevModel } from './catalog.js'

function reasoningFields(model: ModelsDevModel): ModelRuleFields['reasoning'] {
  if (model.reasoning === undefined) return undefined
  if (!model.reasoning) return { control: 'none', levels: [] }
  const options = model.reasoning_options ?? []
  if (options.length === 0) return { control: 'always', levels: [] }
  const efforts = options.flatMap(option => (option.type === 'effort' ? (option.values ?? []) : []))
  const canTurnOff = options.some(option => option.type === 'toggle') || efforts.includes('none')
  const levels = EFFORT_LEVELS.filter(level => efforts.includes(level))
  if (levels.length > 0) return { control: canTurnOff ? 'toggle_effort' : 'effort', levels }
  return { control: canTurnOff ? 'toggle' : 'always', levels: [] }
}

export function modelsDevRuleFields(model: ModelsDevModel): ModelRuleFields {
  const contextWindow = ModelContextWindowSchema.safeParse(model.limit?.context)
  const output = model.limit?.output
  const input = model.modalities?.input
  const reasoning = reasoningFields(model)
  return {
    ...(contextWindow.success && { contextWindow: contextWindow.data }),
    ...(output !== undefined && Number.isInteger(output) && output > 0 && { maxOutputTokens: output }),
    ...(reasoning && { reasoning }),
    ...(input && { input: { image: input.includes('image'), pdf: input.includes('pdf') } }),
  }
}
