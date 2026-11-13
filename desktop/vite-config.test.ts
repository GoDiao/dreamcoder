import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { viteWatchIgnored } from './vite.config'

const desktopRoot = dirname(fileURLToPath(import.meta.url))

describe('desktop build compatibility', () => {
  it('targets Safari 17.5 for the Pierre developer views', () => {
    const config = readFileSync(join(desktopRoot, 'vite.config.ts'), 'utf8')

    expect(config).toContain("target: ['es2021', 'safari17.5']")
  })

  it('does not rely on CSS color-mix for startup-critical shell chrome', () => {
    const css = readFileSync(join(desktopRoot, 'src', 'theme', 'globals.css'), 'utf8')

    expect(css).not.toContain('color-mix(')
    expect(css).toContain('--color-text-secondary-a72')
    expect(css).toContain('--color-outline-a92')
  })

  it('ignores sidecar build files on every platform', () => {
    const ignored = (file: string) => viteWatchIgnored.some((pattern) => pattern.test(file))
    expect(ignored('C:\\repo\\desktop\\.3e6f056dc3c033e1-00000001.bun-build')).toBe(true)
    expect(ignored('/repo/desktop/.bun-cache/bun-linux-x64')).toBe(true)
    expect(ignored('C:\\repo\\desktop\\binaries\\x86_64-pc-windows-msvc\\RCX5375.tmp')).toBe(true)
    expect(ignored('/repo/desktop/binaries/aarch64-apple-darwin/dreamcoder-sidecar')).toBe(true)
    expect(ignored('/repo/desktop/src/main.tsx')).toBe(false)
  })
})
