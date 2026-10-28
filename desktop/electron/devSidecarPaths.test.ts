import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { devSidecarPaths } from './sidecar'

describe('dev sidecar layout', () => {
  it('keeps the sidecar and ripgrep side by side, as in the packaged bin directory', () => {
    const paths = devSidecarPaths('/desktop', 'aarch64-apple-darwin', '')
    expect(paths.binary).toBe(path.join('/desktop', 'binaries', 'aarch64-apple-darwin', 'dreamcoder-sidecar'))
    expect(path.dirname(paths.binary)).toBe(paths.appRoot)
  })

  it('adds the .exe suffix on Windows', () => {
    expect(path.basename(devSidecarPaths('/desktop', 'x86_64-pc-windows-msvc', '.exe').binary)).toBe('dreamcoder-sidecar.exe')
  })

  it('packages each target directory as bin/', () => {
    const config = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'electron-builder.json'), 'utf8'))
    const copies = [config.mac, config.win].flatMap((platform) => platform.extraResources)
    expect(copies).toEqual([
      { from: 'binaries/aarch64-apple-darwin', to: 'bin' },
      { from: 'binaries/x86_64-pc-windows-msvc', to: 'bin' },
    ])
  })
})
