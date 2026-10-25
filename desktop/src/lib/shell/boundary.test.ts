import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : []
  })
}

describe('shell dependency boundary', () => {
  it('keeps every Tauri dependency inside the shell module', () => {
    const root = resolve('src')
    const violations = sourceFiles(root).filter((file) => {
      if (relative(root, file).split(sep).join('/').startsWith('lib/shell/')) return false
      return readFileSync(file, 'utf8').includes('@tauri-apps/')
    }).map((file) => relative(root, file))
    expect(violations).toEqual([])
  })
})
