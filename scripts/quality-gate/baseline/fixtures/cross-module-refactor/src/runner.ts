import { parseConfig } from './config'

export function describeRun(rawConfig: string) {
  const enabled = parseConfig(rawConfig)
  return enabled ? 'enabled' : 'disabled'
}
