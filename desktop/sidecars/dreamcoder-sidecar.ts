import { parseLauncherArgs, resolveSidecarInvocation } from './launcherRouting'
import { PARENT_PID_ENV, parseParentPid, startParentWatchdog } from './parentWatchdog'

const LAUNCHER_ENV_KEYS = [
  'CLAUDE_APP_ROOT',
  'CALLER_DIR',
  'DREAMCODER_CONFIG_DIR',
  'XDG_CACHE_HOME',
  'CLAUDE_H5_AUTO_PUBLIC_URL',
  'CLAUDE_H5_DIST_DIR',
  'DREAMCODER_LEGACY_TERMINAL_CONFIG_PATH',
  PARENT_PID_ENV,
  'APP_VERSION',
] as const

const rawArgs = process.argv.slice(2)
const invocation = resolveSidecarInvocation(rawArgs)
if (!invocation.mode) {
  console.error('dreamcoder-sidecar: missing mode argument (expected "server" or "cli")')
  process.exit(2)
}
const mode = invocation.mode
const { appRoot, args } = parseLauncherArgs(invocation.restArgs, invocation.defaultAppRoot)

process.env.CLAUDE_APP_ROOT = appRoot
process.env.CALLER_DIR ||= process.cwd()
process.argv = [process.argv[0]!, process.argv[1]!, ...args]

await import('../../preload.ts')

if (mode === 'server') {
  startParentWatchdog({ parentPid: parseParentPid(process.env[PARENT_PID_ENV]) })
  const { desktopSidecarEnvironment } = await import('../../src/server/services/terminalService.ts')
  Object.assign(process.env, await desktopSidecarEnvironment(process.env, LAUNCHER_ENV_KEYS))
  const { startServer } = await import('../../src/server/index.ts')
  startServer()
} else {
  await import('../../src/entrypoints/cli.tsx')
}
