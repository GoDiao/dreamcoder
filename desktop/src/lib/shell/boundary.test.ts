import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : []
  })
}

describe('shell dependency boundary', () => {
  it('keeps the page code away from Electron modules', () => {
    const root = resolve('src')
    const violations = sourceFiles(root).filter((file) => {
      return /from ['"]electron['"]/.test(readFileSync(file, 'utf8'))
    }).map((file) => relative(root, file))
    expect(violations).toEqual([])
  })
})
