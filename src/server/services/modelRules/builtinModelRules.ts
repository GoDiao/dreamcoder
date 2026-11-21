import modelRulesJson from '../../config/modelRules.json'
import { ModelRulesTableSchema, type ModelRulesTable } from '../../types/modelRulesTable.js'

export const BUILTIN_MODEL_RULES: ModelRulesTable = ModelRulesTableSchema.parse(modelRulesJson)
