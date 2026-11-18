import { isEnvTruthy } from './envUtils.js'

export const DESKTOP_HOST_ENV = 'DREAMCODER_DESKTOP_HOST'

export function isDesktopHost(): boolean {
  return isEnvTruthy(process.env[DESKTOP_HOST_ENV])
}
