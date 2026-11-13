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
})
