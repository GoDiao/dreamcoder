import { parseLauncherArgs, resolveSidecarInvocation } from './launcherRouting'
import { PARENT_PID_ENV, parseParentPid, startParentWatchdog } from './parentWatchdog'

const rawArgs = process.argv.slice(2)
const invocation = resolveSidecarInvocation(rawArgs)
if (!invocation.mode) {
  console.error('dreamcoder-sidecar: missing mode argument (expected "server", "cli" or "adapters")')
  process.exit(2)
}
const mode = invocation.mode
const restArgs = invocation.restArgs

if (mode === 'adapters') {
  await runAdapters(restArgs)
} else {
  const { appRoot, args } = parseLauncherArgs(restArgs, invocation.defaultAppRoot)

  process.env.CLAUDE_APP_ROOT = appRoot
  process.env.CALLER_DIR ||= process.cwd()
  process.argv = [process.argv[0]!, process.argv[1]!, ...args]

  await import('../../preload.ts')

  if (mode === 'server') {
    startParentWatchdog({ parentPid: parseParentPid(process.env[PARENT_PID_ENV]) })
    const { startServer } = await import('../../src/server/index.ts')
    startServer()
  } else if (mode === 'cli') {
    await import('../../src/entrypoints/cli.tsx')
  } else {
    console.error(`dreamcoder-sidecar: unknown mode "${mode}" (expected "server", "cli" or "adapters")`)
    process.exit(2)
  }
}

async function runAdapters(rawArgs: string[]): Promise<void> {
  console.error('[dreamcoder-sidecar] adapter mode is not available in DreamCoder MVP (Phase 3)')
  process.exit(1)
}
