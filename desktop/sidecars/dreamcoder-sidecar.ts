import { parseLauncherArgs, resolveSidecarInvocation } from './launcherRouting'
import { PARENT_PID_ENV, parseParentPid, startParentWatchdog } from './parentWatchdog'

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
  const { startServer } = await import('../../src/server/index.ts')
  startServer()
} else {
  await import('../../src/entrypoints/cli.tsx')
}
