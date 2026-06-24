import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { clearPathCache, getDirectoryCompletions, scanDirectory } from './directoryCompletion.js'

const cleanupDirs = new Set<string>()

afterEach(async () => {
  clearPathCache()
  for (const dir of cleanupDirs) {
    await fs.rm(dir, { recursive: true, force: true })
  }
  cleanupDirs.clear()
})

describe('directory completion', () => {
  it('includes dot-prefixed directories in directory scans and completions', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'directory-completion-'))
    cleanupDirs.add(fixtureDir)

    await fs.mkdir(path.join(fixtureDir, '.claude'))
    await fs.mkdir(path.join(fixtureDir, '.git'))
    await fs.mkdir(path.join(fixtureDir, 'src'))
    await fs.writeFile(path.join(fixtureDir, '.env'), 'SECRET=example')

    await expect(scanDirectory(fixtureDir)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '.claude', type: 'directory' }),
        expect.objectContaining({ name: 'src', type: 'directory' }),
      ]),
    )
    await expect(scanDirectory(fixtureDir)).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '.git' }),
      ]),
    )

    const completions = await getDirectoryCompletions('./.c', { basePath: fixtureDir })
    expect(completions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayText: '.claude/' }),
      ]),
    )
    expect(completions.some((completion) => completion.displayText === '.env/')).toBe(false)
  })
})
