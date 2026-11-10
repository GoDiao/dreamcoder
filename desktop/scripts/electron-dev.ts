import path from 'node:path'
import electronPath from 'electron'
import type { Subprocess } from 'bun'
import { assertDevServerAvailable, waitForDevServer } from './electron-dev-server'

const desktopRoot = path.resolve(import.meta.dir, '..')
const devUrl = 'http://localhost:1420'
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

process.on('SIGINT', stopAll)
process.on('SIGTERM', stopAll)

try {
  await assertDevServerAvailable(devUrl)
  const devServer = spawn(['bun', 'run', 'dev'])
  await waitForDevServer(devUrl, devServer)
  if (await spawn(['bun', 'run', './scripts/build-electron.ts']).exited !== 0) {
    throw new Error('[electron-dev] building the main process failed')
  }
  if (await spawn(['bun', 'run', 'build:showai-reader']).exited !== 0) {
    throw new Error('[electron-dev] building the ShowAI reader failed')
  }
  const electron = spawn(
    [String(electronPath), 'electron-dist', ...process.argv.slice(2)],
    { ...process.env, DREAMCODER_ELECTRON_DEV_URL: devUrl },
  )
  process.exitCode = await electron.exited
} finally {
  stopAll()
}
