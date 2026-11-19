import { isFirstPartyAnthropicHost } from '../../../utils/model/providers.js'
import type { ApiFormat } from '../../types/provider.js'

export function isOfficialAnthropicProvider(provider: { baseUrl: string; apiFormat: ApiFormat }): boolean {
  return provider.apiFormat === 'anthropic' && isFirstPartyAnthropicHost(provider.baseUrl)
}
