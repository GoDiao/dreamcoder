// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isFileLoadingAllowed, normalizePath, resolveConfig } from 'vite'

const desktopRoot = dirname(fileURLToPath(import.meta.url))

describe('desktop build compatibility', () => {
  it('allows the catalog raw module in development without exposing the repository root', async () => {
    const config = await resolveConfig({ root: desktopRoot, configFile: join(desktopRoot, 'vite.config.ts'), logLevel: 'silent' }, 'serve')
    const catalog = normalizePath(join(desktopRoot, '..', 'mcp-registry.json'))
    expect(isFileLoadingAllowed(config, catalog)).toBe(true)
    expect(isFileLoadingAllowed(config, `${catalog}?raw`)).toBe(true)
    expect(isFileLoadingAllowed(config, normalizePath(join(desktopRoot, '..', 'package.json')))).toBe(false)
    expect(isFileLoadingAllowed(config, normalizePath(join(desktopRoot, '..', '.env')))).toBe(false)
  })

  it('keeps production bundles loadable in the macOS 12 Safari 15 WebView', () => {
    const config = readFileSync(join(desktopRoot, 'vite.config.ts'), 'utf8')

    expect(config).toContain("target: ['es2021', 'safari15']")
  })

  it('does not rely on CSS color-mix for startup-critical shell chrome', () => {
    const css = readFileSync(join(desktopRoot, 'src', 'theme', 'globals.css'), 'utf8')

    expect(css).not.toContain('color-mix(')
    expect(css).toContain('--color-text-secondary-a72')
    expect(css).toContain('--color-outline-a92')
  })
})
