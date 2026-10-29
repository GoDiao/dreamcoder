import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
})
