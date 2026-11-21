import { isClaudeModelName } from '../../utils/model/claudeModelName.js'

export const ATTRIBUTION_HEADER_ENV_KEY = 'CLAUDE_CODE_ATTRIBUTION_HEADER'

export function attributionHeaderEnvForModel(
  modelName?: string | null,
): Record<string, string> {
  const normalizedModel = modelName?.trim()
  if (!normalizedModel) return {}

  return {
    [ATTRIBUTION_HEADER_ENV_KEY]: isClaudeModelName(normalizedModel) ? '1' : '0',
  }
}
