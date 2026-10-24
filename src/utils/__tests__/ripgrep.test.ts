import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { isUsableBuiltinRipgrepPath, resolveRipgrepConfig } from '../ripgrepConfig.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(platform: NodeJS.Platform = 'darwin') {
  const root = await mkdtemp(join(tmpdir(), 'dreamcoder-rg-'))
  tempDirs.push(root)
  const filename = platform === 'win32' ? 'rg.exe' : 'rg'
  const bundled = join(root, 'app', filename)
  const vendor = join(root, 'source', 'vendor', 'ripgrep', `arm64-${platform}`, filename)
  const options = {
    execPath: join(root, 'app', 'dreamcoder-sidecar'),
    sourceRoot: join(root, 'source'),
    platform,
    arch: 'arm64',
    useBuiltinRipgrep: undefined as string | undefined,
    findSystem: (): string | null => '/system/rg',
  }
  async function create(filename: string) {
    await mkdir(join(filename, '..'), { recursive: true })
    await writeFile(filename, '')
  }
  return { bundled, vendor, options, create }
}

describe('ripgrep resolution', () => {
  test('rejects Bun virtual paths and missing paths', () => {
    expect(isUsableBuiltinRipgrepPath('B:\\~BUN\\root\\vendor\\ripgrep\\x64-win32\\rg.exe')).toBe(false)
    expect(isUsableBuiltinRipgrepPath('/$bunfs/root/vendor/ripgrep/arm64-darwin/rg')).toBe(false)
    expect(isUsableBuiltinRipgrepPath(join(tmpdir(), 'missing-dreamcoder-rg'))).toBe(false)
  })

  test('prefers a binary next to the executable over vendor and system', async () => {
    const f = await fixture()
    await f.create(f.bundled)
    await f.create(f.vendor)
    f.options.findSystem = () => { throw new Error('System lookup should not run') }
    expect(resolveRipgrepConfig(f.options)).toEqual({ mode: 'bundled', command: f.bundled, args: ['--no-config'] })
  })

  test('bundled search ignores exclusions from RIPGREP_CONFIG_PATH', async () => {
    const available = resolveRipgrepConfig({
      execPath: process.execPath,
      sourceRoot: resolve(import.meta.dir, '../../..'),
      platform: process.platform,
      arch: process.arch,
      useBuiltinRipgrep: undefined,
      findSystem: () => Bun.which('rg'),
    })
    expect(available.mode).not.toBe('unavailable')
    const f = await fixture(process.platform)
    await f.create(f.bundled)
    await copyFile(available.command, f.bundled)
    const sample = join(f.options.sourceRoot, 'sample.ts')
    await f.create(sample)
    const configPath = join(f.bundled, '..', 'ripgrep.config')
    await writeFile(configPath, '--glob=!*.ts\n')
    const config = resolveRipgrepConfig(f.options)
    const result = spawnSync(
      config.command,
      [...config.args, '--files', f.options.sourceRoot],
      {
        encoding: 'utf8',
        env: { ...process.env, RIPGREP_CONFIG_PATH: configPath },
        windowsHide: true,
      },
    )
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(sample)
  })

  test('uses rg.exe next to the executable on Windows', async () => {
    const f = await fixture('win32')
    await f.create(f.bundled)
    expect(resolveRipgrepConfig(f.options).command).toBe(f.bundled)
  })

  test('uses source vendor when the bundled binary is missing', async () => {
    const f = await fixture()
    await f.create(f.vendor)
    expect(resolveRipgrepConfig(f.options)).toEqual({ mode: 'builtin', command: f.vendor, args: ['--no-config'] })
  })

  test('uses system when both shipped paths are missing', async () => {
    const f = await fixture()
    expect(resolveRipgrepConfig(f.options)).toEqual({ mode: 'system', command: '/system/rg', args: [] })
  })

  test('never dispatches the sidecar as rg when source is a Bun virtual path', async () => {
    const f = await fixture()
    f.options.sourceRoot = '/$bunfs/root'
    f.options.findSystem = () => null
    expect(resolveRipgrepConfig(f.options)).toEqual({ mode: 'unavailable', command: '', args: [] })
    await f.create(f.bundled)
    expect(resolveRipgrepConfig(f.options).command).toBe(f.bundled)
  })

  test('USE_BUILTIN_RIPGREP=0 forces system even when both shipped binaries exist', async () => {
    const f = await fixture()
    await f.create(f.bundled)
    await f.create(f.vendor)
    f.options.useBuiltinRipgrep = '0'
    expect(resolveRipgrepConfig(f.options).mode).toBe('system')
    f.options.findSystem = () => null
    expect(resolveRipgrepConfig(f.options).mode).toBe('unavailable')
  })

  test('reports unavailable when no binary exists', async () => {
    const f = await fixture()
    f.options.findSystem = () => null
    expect(resolveRipgrepConfig(f.options)).toEqual({ mode: 'unavailable', command: '', args: [] })
  })
})
