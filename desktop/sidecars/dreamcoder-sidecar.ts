/**
 * DreamCoder 桌面端合并 sidecar 入口。
 *
 * 把所有运行模式合并到同一个二进制里，调用方通过
 * 第一个 positional 参数选择模式：
 *
 *   dreamcoder-sidecar server   --app-root <path> --host 127.0.0.1 --port 12345
 *   dreamcoder-sidecar cli      --app-root <path> [其它 CLI 参数...]
 *   dreamcoder-sidecar adapters --app-root <path> [--feishu] [--telegram] [--wechat] [--dingtalk]
 *
 * 注意：adapter 模式在 MVP 阶段不可用（Phase 3）。
 */

import { parseLauncherArgs, resolveSidecarInvocation } from './launcherRouting'

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
  // MVP: adapter support is not available (Phase 3).
  // Keep the function signature for interface compatibility,
  // but report that this mode is not yet supported.
  console.error('[dreamcoder-sidecar] adapter mode is not available in DreamCoder MVP (Phase 3)')
  process.exit(1)
}
