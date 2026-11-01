import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { clearSubfolders, option, sourceCommit } from './bundle'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bundle-lib-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('sourceCommit', () => {
  it('throws for a directory that is not a git checkout', () => {
    expect(() => sourceCommit(root)).toThrow('Could not read the commit of the source checkout')
  })
})

describe('clearSubfolders', () => {
  it('removes folders and keeps files', async () => {
    await fs.mkdir(path.join(root, 'old'))
    await fs.writeFile(path.join(root, 'catalog.json'), '{}')

    await clearSubfolders(root)

    expect(await fs.readdir(root)).toEqual(['catalog.json'])
  })
})

describe('option', () => {
  it('reads the value after a flag', () => {
    expect(option(['--out', 'dir'], '--out')).toBe('dir')
    expect(option(['--out'], '--missing')).toBeUndefined()
  })
})
