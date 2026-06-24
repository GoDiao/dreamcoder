// desktop/src/stores/providerOpenAIOAuthStore.ts

import { createOAuthStore } from './providerOAuthStore'
import {
  providerOpenAIOAuthApi,
  type ProviderOpenAIOAuthStatus,
} from '../api/providerOpenAIOauth'

export const useProviderOpenAIOAuthStore = createOAuthStore<ProviderOpenAIOAuthStatus>(providerOpenAIOAuthApi)
