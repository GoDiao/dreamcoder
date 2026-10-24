import { existsSync } from 'node:fs'
import path from 'node:path'
import { isEnvDefinedFalsy } from './envUtils.js'

export type RipgrepConfig = {
  mode: 'system' | 'builtin' | 'bundled' | 'unavailable'
  command: string
  args: string[]
}

export function isUsableBuiltinRipgrepPath(candidatePath: string): boolean {
  const normalized = candidatePath.replace(/\\/g, '/')
  return (
    !['$bunfs', '~BUN'].some(marker => normalized.includes(marker)) &&
    existsSync(candidatePath)
  )
}

export function resolveRipgrepConfig(options: {
  execPath: string
  sourceRoot: string
  platform: NodeJS.Platform
  arch: string
  useBuiltinRipgrep: string | undefined
  findSystem: () => string | null
}): RipgrepConfig {
  if (!isEnvDefinedFalsy(options.useBuiltinRipgrep)) {
    const filename = options.platform === 'win32' ? 'rg.exe' : 'rg'
    const bundled = path.join(path.dirname(options.execPath), filename)
    if (isUsableBuiltinRipgrepPath(bundled)) {
      return { mode: 'bundled', command: bundled, args: ['--no-config'] }
    }
    const builtin = path.join(
      options.sourceRoot,
      'vendor',
      'ripgrep',
      `${options.arch}-${options.platform}`,
      filename,
    )
    if (isUsableBuiltinRipgrepPath(builtin)) {
      return { mode: 'builtin', command: builtin, args: ['--no-config'] }
    }
  }
  const system = options.findSystem()
  return system
    ? { mode: 'system', command: system, args: [] }
    : { mode: 'unavailable', command: '', args: [] }
}
