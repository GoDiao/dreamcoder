import { subprocessEnv } from './subprocessEnv.js'
import {
  getTerminalShellEnvironment,
  mergeTerminalShellEnvironment,
  resetTerminalShellEnvironmentCacheForTests,
  toStringEnv,
} from './terminalShellEnvironment.js'

export async function getMcpStdioEnvironment(
  configEnv?: Record<string, string>,
): Promise<Record<string, string>> {
  const baseEnv = toStringEnv(subprocessEnv())
  const explicitPath = configEnv && Object.hasOwn(configEnv, 'PATH')
  const shellEnv = explicitPath
    ? null
    : await getTerminalShellEnvironment(baseEnv)

  return {
    ...mergeTerminalShellEnvironment(baseEnv, shellEnv),
    ...(configEnv ?? {}),
  }
}

export function resetMcpStdioEnvironmentCacheForTests(): void {
  resetTerminalShellEnvironmentCacheForTests()
}
