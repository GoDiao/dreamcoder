import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateExportPath, writeSessionExport } from './sessionExport'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'electron-session-export-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('session export', () => {
  it('accepts only absolute markdown or json paths', () => {
    expect(validateExportPath(path.join(dir, 'a.md'))).toBe(path.join(dir, 'a.md'))
    expect(validateExportPath(path.join(dir, 'a.JSON'))).toBe(path.join(dir, 'a.JSON'))
    expect(() => validateExportPath(path.join(dir, 'a.sh'))).toThrow('Exports must be .md or .json files')
    expect(() => validateExportPath(path.join(dir, 'noext'))).toThrow('Exports must be .md or .json files')
    expect(() => validateExportPath('relative.md')).toThrow('Export path must be absolute')
  })

  it('writes the file and names it in errors', async () => {
    const file = path.join(dir, 'session.markdown')
    await writeSessionExport(file, '# Session')
    expect(readFileSync(file, 'utf8')).toBe('# Session')
    const missing = path.join(dir, 'missing', 'session.md')
    await expect(writeSessionExport(missing, 'x')).rejects.toThrow(`Could not write ${missing}`)
  })
})
