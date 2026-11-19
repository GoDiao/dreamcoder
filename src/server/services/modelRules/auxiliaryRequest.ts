import { auxiliaryThinking } from '../../../utils/model/modelRules.js'
import type { AnthropicRequest } from '../../proxy/transform/types.js'
import { toCliModelRules } from './cliModelRulesEnv.js'
import { isOfficialAnthropicProvider } from './officialAnthropicProvider.js'
import { resolveModelRules, type ModelRulesProvider } from './resolveModelRules.js'

export type AuxiliaryRequestFields = Pick<AnthropicRequest, 'thinking' | 'output_config'>

export function auxiliaryRequestFields(
  provider: ModelRulesProvider,
  modelId: string,
): AuxiliaryRequestFields | undefined {
  if (isOfficialAnthropicProvider(provider)) return undefined
  const rules = toCliModelRules(resolveModelRules(provider, modelId), provider.apiFormat)
  const { thinking, effort } = auxiliaryThinking(rules, false)
  return {
    ...(thinking === 'off' && { thinking: { type: 'disabled' } }),
    ...(effort && { output_config: { effort } }),
  }
}
