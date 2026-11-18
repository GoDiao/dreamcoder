import { isEnvTruthy } from './envUtils.js'

export const PROVIDER_PROXIED_ENV_KEY = 'DREAMCODER_PROVIDER_PROXIED'

export function isProviderProxied(): boolean {
  return isEnvTruthy(process.env[PROVIDER_PROXIED_ENV_KEY])
}
