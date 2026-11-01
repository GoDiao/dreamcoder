import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { convertDesignSystems, parseManifest, readSwatches, summarizeSystem, type Curation, type StarterSet } from './convert'

const APACHE = `                                 Apache License
                           Version 2.0, January 2004

   Copyright 2026 Open Design contributors

   Licensed under the Apache License, Version 2.0`
const MIT = `MIT License

Copyright (c) 2026 Cloudflare, Inc.

Permission is hereby granted`
const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const TOKENS = ':root {\n  --bg: #ffffff;\n  --surface: #f5f5f5;\n  --fg: #111111;\n  --accent: #ff5701;\n  --accent-hover: color-mix(in oklab, var(--accent), black 8%);\n}\n'

let root: string
let source: string
let starters: string
let licenses: string
let out: string

function manifest(id: string, origin = 'OpenDesign curated bundled fixture', extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 'od-design-system-project/v1',
    id,
    name: `Name of ${id}`,
    category: 'Modern & Minimal',
    description: 'A short\n  description.',
    source: { type: 'bundled', origin },
    ...extra,
  })
}

async function writeSource(id: string, options: { origin?: string; tokens?: string; manifestText?: string } = {}) {
  const folder = path.join(source, 'design-systems', id)
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'manifest.json'), options.manifestText ?? manifest(id, options.origin))
  await fs.writeFile(path.join(folder, 'DESIGN.md'), `# ${id}`)
  await fs.writeFile(path.join(folder, 'tokens.css'), options.tokens ?? TOKENS)
  await fs.writeFile(path.join(folder, 'components.html'), '<p>not shipped</p>')
  await fs.mkdir(path.join(folder, 'preview'))
  await fs.writeFile(path.join(folder, 'DESIGN-zh.md'), 'not shipped')
}

const curation = (overrides: Partial<Curation> = {}): Curation => ({
  sourceRepo: 'https://example.com/open-design',
  bundledOrigin: 'OpenDesign curated bundled fixture',
  excluded: {},
  exceptions: {},
  ...overrides,
})

const starterSet = (ids: string[] = []): StarterSet => ({
  sourceRepo: 'https://example.com/open-design',
  starters: ids.map(id => ({ id, name: { en: id, zh: `${id} 名` }, category: 'Starter', description: { en: 'd', zh: '描述' } })),
})

const convert = (curationValue = curation(), set = starterSet()) =>
  convertDesignSystems({ sourceDir: source, curation: curationValue, starterSet: set, starterDir: starters, licenseDir: licenses, outDir: out, commit: COMMIT })

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-systems-'))
  source = path.join(root, 'source')
  starters = path.join(root, 'starters')
  licenses = path.join(root, 'licenses')
  out = path.join(root, 'out')
  await fs.mkdir(path.join(source, 'design-systems', '_schema'), { recursive: true })
  await fs.writeFile(path.join(source, 'LICENSE'), APACHE)
  await fs.mkdir(licenses, { recursive: true })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('parseManifest', () => {
  it('reads the catalog fields and collapses the description', () => {
    expect(parseManifest('a', manifest('a'))).toEqual({
      id: 'a',
      name: 'Name of a',
      category: 'Modern & Minimal',
      description: 'A short description.',
      origin: 'OpenDesign curated bundled fixture',
    })
  })

  it('rejects a manifest whose id differs from its folder', () => {
    expect(() => parseManifest('a', manifest('b'))).toThrow('manifest id is b')
  })

  it('rejects another manifest schema', () => {
    expect(() => parseManifest('a', manifest('a', undefined, { schemaVersion: 'other' }))).toThrow('unexpected manifest schema')
  })
})

describe('summarizeSystem', () => {
  const boilerplate = 'Bundled OpenDesign package for Alpha, derived from curated DESIGN.md, tokens.css, and components.html fixtures.'

  it('keeps a manifest description that says something', () => {
    expect(summarizeSystem('Calm editorial pages.', '# A\n\n> Category: X\n> Other')).toBe('Calm editorial pages.')
  })

  it('takes the line under the category from DESIGN.md when the manifest only has the boilerplate', () => {
    expect(summarizeSystem(boilerplate, '# A\n\n> Category: X\n> Forward-looking   and sleek.\n\n## 1.')).toBe('Forward-looking and sleek.')
  })

  it('keeps the boilerplate when DESIGN.md has no such line', () => {
    expect(summarizeSystem(boilerplate, '---\nname: A\n---\n# A')).toBe(boilerplate)
  })
})

describe('readSwatches', () => {
  it('returns the background, surface, text and accent colors in that order', () => {
    expect(readSwatches('a', TOKENS)).toEqual(['#ffffff', '#f5f5f5', '#111111', '#ff5701'])
  })

  it('fails when a swatch variable is not a color literal', () => {
    expect(() => readSwatches('a', TOKENS.replace('--accent: #ff5701', '--accent: var(--bg)'))).toThrow('--accent is not a color literal')
  })

  it('fails when a swatch variable is missing', () => {
    expect(() => readSwatches('a', TOKENS.replace('--fg: #111111;', ''))).toThrow('--fg is not a color literal')
  })
})

describe('convertDesignSystems', () => {
  it('keeps only DESIGN.md and tokens.css and records the root license and the upstream path', async () => {
    await writeSource('alpha')
    const catalog = await convert()
    expect(catalog.systems).toEqual([
      {
        id: 'alpha',
        name: { en: 'Name of alpha', zh: '' },
        category: 'Modern & Minimal',
        description: { en: 'A short description.', zh: '' },
        origin: 'converted',
        swatches: ['#ffffff', '#f5f5f5', '#111111', '#ff5701'],
        license: { id: 'Apache-2.0', file: null, copyright: 'Copyright 2026 Open Design contributors' },
        author: 'Open Design contributors',
        upstream: { repo: 'https://example.com/open-design', commit: COMMIT, path: 'design-systems/alpha' },
      },
    ])
    expect((await fs.readdir(path.join(out, 'alpha'))).sort()).toEqual(['DESIGN.md', 'tokens.css'])
    expect(await fs.readFile(path.join(out, 'LICENSE-open-design.txt'), 'utf-8')).toBe(APACHE)
    expect(JSON.parse(await fs.readFile(path.join(out, 'catalog.json'), 'utf-8')).systems).toHaveLength(1)
  })

  it('uses the description from DESIGN.md for a boilerplate manifest description', async () => {
    await writeSource('alpha', { manifestText: manifest('alpha').replace('A short\\n  description.', 'Bundled OpenDesign package for Alpha, derived from curated fixtures.') })
    await fs.writeFile(path.join(source, 'design-systems', 'alpha', 'DESIGN.md'), '# Alpha\n\n> Category: X\n> Sleek and quiet.\n')
    expect((await convert()).systems[0]!.description.en).toBe('Sleek and quiet.')
  })

  it('skips excluded packages', async () => {
    await writeSource('alpha')
    await writeSource('beta', { origin: 'https://example.com/unknown' })
    const catalog = await convert(curation({ excluded: { beta: 'no license' } }))
    expect(catalog.systems.map(system => system.id)).toEqual(['alpha'])
    await expect(fs.stat(path.join(out, 'beta'))).rejects.toThrow()
  })

  it('fails on an origin that is neither bundled nor curated', async () => {
    await writeSource('beta', { origin: 'https://example.com/unknown' })
    await expect(convert()).rejects.toThrow('neither the bundled origin nor listed')
  })

  it('takes the license of a curated exception from its own text and ships that text', async () => {
    await writeSource('kumo', { origin: 'integration of another upstream' })
    await fs.writeFile(path.join(licenses, 'kumo.txt'), MIT)
    const catalog = await convert(curation({ exceptions: { kumo: { licenseId: 'MIT', licenseText: 'kumo.txt', author: 'Cloudflare, Inc.' } } }))
    expect(catalog.systems[0]!.license).toEqual({ id: 'MIT', file: 'LICENSE', copyright: 'Copyright (c) 2026 Cloudflare, Inc.' })
    expect(catalog.systems[0]!.author).toBe('Cloudflare, Inc.')
    expect(await fs.readFile(path.join(out, 'kumo', 'LICENSE'), 'utf-8')).toBe(MIT)
  })

  it('fails when the license text of an exception is another license', async () => {
    await writeSource('kumo', { origin: 'integration of another upstream' })
    await fs.writeFile(path.join(licenses, 'kumo.txt'), APACHE)
    await expect(
      convert(curation({ exceptions: { kumo: { licenseId: 'MIT', licenseText: 'kumo.txt', author: 'x' } } })),
    ).rejects.toThrow('the license text is Apache-2.0')
  })

  it('puts the starters first and copies their files', async () => {
    await writeSource('alpha')
    await fs.mkdir(path.join(starters, 'starter-one'), { recursive: true })
    await fs.writeFile(path.join(starters, 'starter-one', 'DESIGN.md'), '# one')
    await fs.writeFile(path.join(starters, 'starter-one', 'tokens.css'), TOKENS)
    const catalog = await convert(curation(), starterSet(['starter-one']))
    expect(catalog.systems.map(system => [system.id, system.origin])).toEqual([['starter-one', 'starter'], ['alpha', 'converted']])
    expect(catalog.systems[0]!.upstream).toBeNull()
    expect(catalog.systems[0]!.name.zh).toBe('starter-one 名')
    expect(await fs.readFile(path.join(out, 'starter-one', 'DESIGN.md'), 'utf-8')).toBe('# one')
  })

  it('fails when a starter id is also a converted id', async () => {
    await writeSource('alpha')
    await fs.mkdir(path.join(starters, 'alpha'), { recursive: true })
    await fs.writeFile(path.join(starters, 'alpha', 'DESIGN.md'), '# a')
    await fs.writeFile(path.join(starters, 'alpha', 'tokens.css'), TOKENS)
    await expect(convert(curation(), starterSet(['alpha']))).rejects.toThrow('also used by a converted system')
  })

  it('removes folders left from an earlier run', async () => {
    await writeSource('alpha')
    await fs.mkdir(path.join(out, 'stale'), { recursive: true })
    await convert()
    await expect(fs.stat(path.join(out, 'stale'))).rejects.toThrow()
  })

  it('fails when a package has no tokens.css', async () => {
    await writeSource('alpha')
    await fs.rm(path.join(source, 'design-systems', 'alpha', 'tokens.css'))
    await expect(convert()).rejects.toThrow('alpha: tokens.css is missing')
  })
})
