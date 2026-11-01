import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { bundledDirCandidates } from '../bundledContent.js'
import {
  installDesignSystem,
  parseDesignSystemManifest,
  readDesignSystemCatalog,
  renderDesignSystemIndex,
  resolveDesignSystemsDir,
  scanDesignSystems,
} from '../designSystems.js'
import { systemRecord, writeSystems } from './designSystemFixtures.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-systems-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const library = () => path.join(root, 'library')
const artifacts = () => path.join(root, 'work', 'dc_artifacts')

describe('resolveDesignSystemsDir', () => {
  it('finds the folder next to the bundled binaries of a packaged app', async () => {
    const appRoot = path.join(root, 'Resources', 'bin')
    await fs.mkdir(appRoot, { recursive: true })
    await writeSystems(path.join(root, 'Resources', 'design-systems'), [systemRecord('a')])
    expect(await resolveDesignSystemsDir(bundledDirCandidates('design-systems', appRoot, '/nowhere'))).toBe(path.join(root, 'Resources', 'design-systems'))
  })

  it('finds the source folder from the development binaries folder', async () => {
    const appRoot = path.join(root, 'desktop', 'binaries', 'aarch64-apple-darwin')
    await fs.mkdir(appRoot, { recursive: true })
    await writeSystems(path.join(root, 'desktop', 'design-systems'), [systemRecord('a')])
    expect(await resolveDesignSystemsDir(bundledDirCandidates('design-systems', appRoot, '/nowhere'))).toBe(path.join(root, 'desktop', 'design-systems'))
  })

  it('fails with the name of the catalog when nothing is found', async () => {
    await expect(resolveDesignSystemsDir(bundledDirCandidates('design-systems', undefined, root))).rejects.toThrow('design system catalog was not found')
  })
})

describe('readDesignSystemCatalog', () => {
  it('rejects a catalog with the wrong shape', async () => {
    await fs.mkdir(library(), { recursive: true })
    await fs.writeFile(path.join(library(), 'catalog.json'), JSON.stringify({ version: 1, templates: [] }))
    await expect(readDesignSystemCatalog(library())).rejects.toThrow('not valid')
  })
})

describe('parseDesignSystemManifest', () => {
  it('lists every missing field', () => {
    expect(parseDesignSystemManifest('{"version":1}').error).toBe('name is required; source must be bundled or extracted; license is required; author is required')
  })

  it('rejects text that is not JSON', () => {
    expect(parseDesignSystemManifest('{').error).toContain('not valid JSON')
  })

  it('reads an extracted system without upstream', () => {
    expect(parseDesignSystemManifest('{"version":1,"name":"Acme","source":"extracted","license":"unspecified","author":"Agent"}').manifest).toEqual({
      version: 1,
      name: 'Acme',
      source: 'extracted',
      license: 'unspecified',
      author: 'Agent',
    })
  })
})

describe('installDesignSystem', () => {
  it('copies the folder to systems/<name> and writes system.json with the origin', async () => {
    await writeSystems(library(), [systemRecord('alpha')])
    const installed = await installDesignSystem({ systemId: 'alpha', artifactsDir: artifacts(), systemsDir: library() })
    expect(installed.name).toBe('alpha')
    expect(installed.dir).toBe(path.join(artifacts(), 'systems', 'alpha'))
    expect(installed.reused).toBe(false)
    expect((await fs.readdir(installed.dir)).sort()).toEqual(['DESIGN.md', 'system.json', 'tokens.css'])
    const entries = await scanDesignSystems(artifacts())
    expect(entries).toHaveLength(1)
    expect(entries[0]!.manifest).toEqual({
      version: 1,
      name: 'Name of alpha',
      source: 'bundled',
      license: 'Apache-2.0',
      author: 'Open Design contributors',
      libraryId: 'alpha',
      upstream: { repo: 'https://example.com/repo', commit: 'abc123', path: 'design-systems/alpha' },
    })
  })

  it('omits upstream for a starter', async () => {
    await writeSystems(library(), [systemRecord('own', { origin: 'starter', upstream: null, author: 'DreamCoder' })])
    const installed = await installDesignSystem({ systemId: 'own', artifactsDir: artifacts(), systemsDir: library() })
    expect(installed.manifest.upstream).toBeUndefined()
    expect(installed.manifest.author).toBe('DreamCoder')
  })

  it('reuses the copy that is already in the project', async () => {
    await writeSystems(library(), [systemRecord('alpha')])
    const first = await installDesignSystem({ systemId: 'alpha', artifactsDir: artifacts(), systemsDir: library() })
    await fs.writeFile(path.join(first.dir, 'tokens.css'), ':root { --bg: red; }')
    const second = await installDesignSystem({ systemId: 'alpha', artifactsDir: artifacts(), systemsDir: library() })
    expect(second.reused).toBe(true)
    expect(second.dir).toBe(first.dir)
    expect(await fs.readFile(path.join(first.dir, 'tokens.css'), 'utf-8')).toBe(':root { --bg: red; }')
    expect(await fs.readdir(path.join(artifacts(), 'systems'))).toEqual(['alpha'])
  })

  it('adds a suffix when another folder holds the name', async () => {
    await writeSystems(library(), [systemRecord('alpha')])
    await fs.mkdir(path.join(artifacts(), 'systems', 'alpha'), { recursive: true })
    const installed = await installDesignSystem({ systemId: 'alpha', artifactsDir: artifacts(), systemsDir: library() })
    expect(installed.name).toBe('alpha-2')
  })

  it('rejects an unknown id and creates nothing', async () => {
    await writeSystems(library(), [systemRecord('alpha')])
    await expect(installDesignSystem({ systemId: 'nope', artifactsDir: artifacts(), systemsDir: library() })).rejects.toThrow('Unknown design system')
    await expect(fs.stat(path.join(artifacts(), 'systems'))).rejects.toThrow()
  })

  it('rejects a name that is not safe', async () => {
    await writeSystems(library(), [systemRecord('alpha')])
    await expect(installDesignSystem({ systemId: 'alpha', artifactsDir: artifacts(), systemsDir: library(), name: '../x' })).rejects.toThrow('not a design system name')
  })

  it('leaves no folder when the library folder lacks tokens.css', async () => {
    await writeSystems(library(), [systemRecord('alpha')], { alpha: { 'DESIGN.md': '# a' } })
    await expect(installDesignSystem({ systemId: 'alpha', artifactsDir: artifacts(), systemsDir: library() })).rejects.toThrow('tokens.css of design system alpha is missing')
    expect(await fs.readdir(path.join(artifacts(), 'systems'))).toEqual([])
  })

  it('leaves no folder when the library folder is missing', async () => {
    await writeSystems(library(), [systemRecord('alpha')])
    await fs.rm(path.join(library(), 'alpha'), { recursive: true })
    await expect(installDesignSystem({ systemId: 'alpha', artifactsDir: artifacts(), systemsDir: library() })).rejects.toThrow('were not found')
    await expect(fs.stat(path.join(artifacts(), 'systems'))).rejects.toThrow()
  })
})

describe('scanDesignSystems', () => {
  it('lists folders with system.json, flags an invalid one and ignores folders without it', async () => {
    const systems = path.join(artifacts(), 'systems')
    await fs.mkdir(path.join(systems, 'good'), { recursive: true })
    await fs.writeFile(path.join(systems, 'good', 'system.json'), '{"version":1,"name":"Good","source":"extracted","license":"x","author":"y"}')
    await fs.mkdir(path.join(systems, 'bad'), { recursive: true })
    await fs.writeFile(path.join(systems, 'bad', 'system.json'), '{"version":2}')
    await fs.mkdir(path.join(systems, 'plain'), { recursive: true })
    const entries = await scanDesignSystems(artifacts())
    expect(entries.map(entry => [entry.name, entry.manifest?.name ?? null, entry.error !== null])).toEqual([
      ['bad', null, true],
      ['good', 'Good', false],
    ])
  })

  it('returns an empty list when there is no systems folder', async () => {
    expect(await scanDesignSystems(artifacts())).toEqual([])
  })
})

describe('renderDesignSystemIndex', () => {
  it('lists the starters first and groups the others by category', () => {
    const index = renderDesignSystemIndex([
      systemRecord('b', { category: 'Fintech' }),
      systemRecord('own', { origin: 'starter', category: 'Editorial' }),
      systemRecord('a', { category: 'Fintech' }),
    ])
    expect(index.split('\n\n')[0]).toContain('### DreamCoder starters')
    expect(index).toContain('### Fintech\n- b (Name of b): Description of b.\n- a (Name of a): Description of a.')
  })

  it('cuts a long description at a word', () => {
    const index = renderDesignSystemIndex([systemRecord('a', { description: { en: `${'word '.repeat(60)}`, zh: '' } })])
    expect(index.split('\n').at(-1)!.endsWith('word…')).toBe(true)
    expect(index.length).toBeLessThan(200)
  })
})

describe('the bundled library', () => {
  const desktop = path.resolve(import.meta.dir, '..', '..', '..', 'desktop')

  it('has the files, four swatches and the license for every system', async () => {
    const dir = path.join(desktop, 'design-systems')
    const catalog = await readDesignSystemCatalog(dir)
    const starters = catalog.systems.filter(system => system.origin === 'starter')
    expect(starters.length).toBeGreaterThanOrEqual(4)
    expect(catalog.systems.length).toBeGreaterThan(100)
    expect(new Set(catalog.systems.map(system => system.id)).size).toBe(catalog.systems.length)
    for (const system of catalog.systems) {
      await fs.stat(path.join(dir, system.id, 'DESIGN.md'))
      expect(await fs.readFile(path.join(dir, system.id, 'tokens.css'), 'utf-8')).toContain('--accent')
      expect(system.swatches).toHaveLength(4)
      if (system.license.file) await fs.stat(path.join(dir, system.id, system.license.file))
      expect(system.name.en && system.description.en && system.license.id && system.author).toBeTruthy()
    }
    for (const starter of starters) expect(starter.name.zh && starter.description.zh).toBeTruthy()
    expect(catalog.systems.some(system => system.id === 'tom-modern')).toBe(false)
    await fs.stat(path.join(dir, 'LICENSE-open-design.txt'))
  })

  it('resolves from the development app root the sidecar is started with', async () => {
    const appRoot = path.join(desktop, 'binaries', 'aarch64-apple-darwin')
    expect(await resolveDesignSystemsDir(bundledDirCandidates('design-systems', appRoot, '/nowhere'))).toBe(path.join(desktop, 'design-systems'))
  })
})
