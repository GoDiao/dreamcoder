import { isEnvTruthy } from '../../utils/envUtils.js'

export const START_SESSION_TOOL_NAME = 'StartSession'
export const SESSION_LINKS_ENABLED_ENV = 'DREAMCODER_SESSION_LINKS'
export const SESSION_ADDRESS_PREFIX = 'session:'

export function isSessionLinksEnabled(): boolean {
  return isEnvTruthy(process.env[SESSION_LINKS_ENABLED_ENV])
}
