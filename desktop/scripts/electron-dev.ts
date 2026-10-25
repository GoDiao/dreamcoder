import path from 'node:path'
import electronPath from 'electron'
import type { Subprocess } from 'bun'

const desktopRoot = path.resolve(import.meta.dir, '..')
const devUrl = 'http://localhost:1420'
const startupTimeoutMs = 60_000
const children: Subprocess[] = []

function spawn(cmd: string[], env?: Record<string, string | undefined>) {
  const child = Bun.spawn(cmd, { cwd: desktopRoot, env: env ?? process.env, stdout: 'inherit', stderr: 'inherit' })
  children.push(child)
  return child
}

function stopAll() {
  for (const child of children) {
    if (child.exitCode === null) child.kill()
  }
}

async function waitForDevServer() {
  const deadline = Date.now() + startupTimeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(devUrl)).ok) return
    } catch {
      await Bun.sleep(250)
    }
  }
  throw new Error(`[electron-dev] Vite did not answer on ${devUrl} within ${startupTimeoutMs / 1000} seconds`)
}

process.on('SIGINT', stopAll)
process.on('SIGTERM', stopAll)

try {
  spawn(['bun', 'run', 'dev'])
  await waitForDevServer()
  if (await spawn(['bun', 'run', './scripts/build-electron.ts']).exited !== 0) {
    throw new Error('[electron-dev] building the main process failed')
  }
  const electron = spawn(
    [String(electronPath), 'electron-dist', ...process.argv.slice(2)],
    { ...process.env, DREAMCODER_ELECTRON_DEV_URL: devUrl },
  )
  process.exitCode = await electron.exited
} finally {
  stopAll()
}
