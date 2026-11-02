import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseLicense } from '../lib/bundle'
import { buildRecord, convertTemplates, parseFrontmatter, styleProblems, summarize, type Curation, type TemplateCuration } from './convert'

const APACHE = `                                 Apache License
                           Version 2.0, January 2004

   Copyright 2026 Open Design contributors

   Licensed under the Apache License, Version 2.0`
const MIT = `MIT License

Copyright (c) 2026 Zara Zhang

Permission is hereby granted`
const COMMIT = '0123456789abcdef0123456789abcdef01234567'

const skill = (extra = '') => `---
name: demo
description: |
  A demo page with a hero.
  Use when the brief says "demo".
od:
  mode: prototype
  platform: desktop
  scenario: marketing
  design_system:
    requires: true
  inputs:
    - name: product_name
      type: string
      required: true
    - name: count
      type: integer
      default: 3
${extra}---

# Demo
`

function curation(overrides: Partial<TemplateCuration> = {}): TemplateCuration {
  return {
    category: 'web',
    acceptsDesignSystem: true,
    title: { en: 'Demo', zh: '演示' },
    descriptionZh: '一个演示页面',
    tags: ['demo'],
    prompt: { en: 'keep', zh: '保留' },
    style: { en: 'Quiet and light.', zh: '安静、明亮。' },
    ...overrides,
  }
}

let root: string
let source: string
let out: string

async function writeTemplate(id: string, files: Record<string, string>, sourceDir = 'design-templates') {
  const folder = path.join(source, sourceDir, id)
  await fs.mkdir(folder, { recursive: true })
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(folder, name), content)
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-convert-'))
  source = path.join(root, 'open-design')
  out = path.join(root, 'out')
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(path.join(source, 'LICENSE'), APACHE)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('parseFrontmatter', () => {
  it('reads the YAML block at the top of SKILL.md', () => {
    expect(parseFrontmatter(skill())).toMatchObject({ name: 'demo', od: { mode: 'prototype' } })
  })

  it('rejects a file without frontmatter', () => {
    expect(() => parseFrontmatter('# Title')).toThrow('no frontmatter')
  })
})

describe('summarize', () => {
  it('collapses whitespace and drops the usage sentences', () => {
    expect(summarize('A page\n  with a hero.\nUse when the brief says "x".')).toBe('A page with a hero.')
    expect(summarize('Single page. Trigger keywords: "a", "b".')).toBe('Single page.')
  })
})

describe('parseLicense', () => {
  it('recognises MIT and Apache-2.0 with their copyright line', () => {
    expect(parseLicense(MIT)).toEqual({ id: 'MIT', copyright: 'Copyright (c) 2026 Zara Zhang' })
    expect(parseLicense(APACHE)).toEqual({ id: 'Apache-2.0', copyright: 'Copyright 2026 Open Design contributors' })
  })

  it('rejects an unknown license and a license without a copyright line', () => {
    expect(() => parseLicense('GPL\nCopyright 2026 X')).toThrow('not MIT or Apache-2.0')
    expect(() => parseLicense('MIT License\n\nno holder')).toThrow('no copyright line')
  })
})

describe('styleProblems', () => {
  it('accepts a short one-line pair and reports nothing', () => {
    expect(styleProblems({ en: 'Calm and light.', zh: '平静明亮。' })).toEqual([])
  })
})

describe('buildRecord', () => {
  const base = { id: 'demo', license: { id: 'Apache-2.0', file: null, copyright: 'c' }, author: 'a', repo: 'r', commit: COMMIT }

  it('maps the metadata onto the catalog record and carries the style', () => {
    const record = buildRecord({ ...base, metadata: parseFrontmatter(skill()), curation: curation() })
    expect(record).toMatchObject({
      id: 'demo',
      category: 'web',
      platform: 'desktop',
      scenario: 'marketing',
      entry: 'index.html',
      acceptsDesignSystem: true,
      description: { en: 'A demo page with a hero.', zh: '一个演示页面' },
      style: { en: 'Quiet and light.', zh: '安静、明亮。' },
      source: { repo: 'r', commit: COMMIT, path: 'design-templates/demo' },
    })
    expect(record.params).toEqual([
      { name: 'product_name', type: 'string', required: true },
      { name: 'count', type: 'integer', required: false, default: 3 },
    ])
  })

  it('requires a one-line style in both languages', () => {
    const metadata = parseFrontmatter(skill())
    const build = (style: unknown) => buildRecord({ ...base, metadata, curation: curation({ style: style as never }) })
    expect(() => build(undefined)).toThrow('demo: style needs an English and a Chinese sentence')
    expect(() => build({ en: 'Only English.', zh: '' })).toThrow('style needs')
    expect(() => build({ en: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty thirty-one', zh: '短' })).toThrow('longer than 30 words')
    expect(() => build({ en: 'Short.', zh: '字'.repeat(61) })).toThrow('longer than 60 characters')
    expect(() => build({ en: 'Two\nlines.', zh: '一行' })).toThrow('one line')
  })

  it('writes the source folder into the record, defaulting to design-templates', () => {
    const metadata = parseFrontmatter(skill())
    expect(buildRecord({ ...base, metadata, curation: curation() }).source.path).toBe('design-templates/demo')
    expect(buildRecord({ ...base, metadata, curation: curation({ sourceDir: 'skills' }) }).source.path).toBe('skills/demo')
    expect(() => buildRecord({ ...base, metadata, curation: curation({ sourceDir: '../x' as never }) })).toThrow('unknown source folder')
  })

  it('has no slides category and writes no kind', () => {
    const metadata = parseFrontmatter(skill())
    expect(() => buildRecord({ ...base, metadata, curation: curation({ category: 'slides' as never }) })).toThrow('unknown category slides')
    expect('kind' in buildRecord({ ...base, metadata, curation: curation() })).toBe(false)
  })

  it('rejects an unknown category and a missing Chinese description', () => {
    const metadata = parseFrontmatter(skill())
    expect(() => buildRecord({ ...base, metadata, curation: curation({ category: 'poster' as never }) })).toThrow('unknown category')
    expect(() => buildRecord({ ...base, metadata, curation: curation({ descriptionZh: undefined }) })).toThrow('no Chinese description')
  })
})

describe('convertTemplates', () => {
  const run = (templates: Record<string, TemplateCuration>) =>
    convertTemplates({ sourceDir: source, curation: { sourceRepo: 'https://example.com/open-design', templates } satisfies Curation, outDir: out, commit: COMMIT })

  it('writes index.html, the catalog and the licenses, attributing templates without their own license to the root license', async () => {
    await writeTemplate('plain', { 'SKILL.md': skill(), 'example.html': '<h1>plain</h1>' })
    await writeTemplate('own', { 'SKILL.md': skill(), 'example.html': '<h1>own</h1>', LICENSE: MIT })
    const catalog = await run({ plain: curation(), own: curation() })

    expect(await fs.readFile(path.join(out, 'plain', 'index.html'), 'utf-8')).toBe('<h1>plain</h1>')
    expect(await fs.readdir(path.join(out, 'plain'))).toEqual(['index.html'])
    expect((await fs.readdir(path.join(out, 'own'))).sort()).toEqual(['LICENSE', 'index.html'])
    expect(await fs.readFile(path.join(out, 'own', 'LICENSE'), 'utf-8')).toBe(MIT)
    expect(await fs.readFile(path.join(out, 'LICENSE-open-design.txt'), 'utf-8')).toBe(APACHE)

    expect(catalog.templates.map(template => [template.id, template.license, template.author])).toEqual([
      ['plain', { id: 'Apache-2.0', file: null, copyright: 'Copyright 2026 Open Design contributors' }, 'Open Design contributors'],
      ['own', { id: 'MIT', file: 'LICENSE', copyright: 'Copyright (c) 2026 Zara Zhang' }, 'Zara Zhang'],
    ])
    expect(JSON.parse(await fs.readFile(path.join(out, 'catalog.json'), 'utf-8'))).toEqual(catalog)
  })

  it('reads each template from its own source folder', async () => {
    await writeTemplate('plain', { 'SKILL.md': skill(), 'example.html': '<h1>plain</h1>' })
    await writeTemplate('extra', { 'SKILL.md': skill(), 'example.html': '<h1>extra</h1>' }, 'skills')
    const catalog = await run({ plain: curation(), extra: curation({ sourceDir: 'skills' }) })
    expect(await fs.readFile(path.join(out, 'extra', 'index.html'), 'utf-8')).toBe('<h1>extra</h1>')
    expect(catalog.templates.map(template => template.source.path)).toEqual(['design-templates/plain', 'skills/extra'])
    await expect(run({ extra: curation() })).rejects.toThrow('extra: the source folder or its SKILL.md is missing')
  })

  it('refuses a source folder that is not one of the two, before reading anything', async () => {
    await expect(run({ evil: curation({ sourceDir: '../outside' as never }) })).rejects.toThrow('unknown source folder')
  })

  it('removes template folders of an earlier run that are no longer listed', async () => {
    await writeTemplate('plain', { 'SKILL.md': skill(), 'example.html': 'x' })
    await fs.mkdir(path.join(out, 'stale'), { recursive: true })
    await fs.writeFile(path.join(out, 'stale', 'index.html'), 'old')
    await run({ plain: curation() })
    expect(await fs.readdir(out)).not.toContain('stale')
  })

  it('fails and writes nothing when a template has no source folder, no SKILL.md or no example', async () => {
    await expect(run({ ghost: curation() })).rejects.toThrow('ghost: the source folder or its SKILL.md is missing')
    await writeTemplate('bare', { 'SKILL.md': skill() })
    await expect(run({ bare: curation() })).rejects.toThrow('bare: example.html is missing')
    expect(await fs.readdir(out).catch(() => [])).toEqual([])
  })

  it('fails when the source repository has no root license or a template carries an unknown license', async () => {
    await writeTemplate('odd', { 'SKILL.md': skill(), 'example.html': 'x', LICENSE: 'Some custom terms' })
    await expect(run({ odd: curation() })).rejects.toThrow('no copyright line')
    await fs.rm(path.join(source, 'LICENSE'))
    await expect(run({ odd: curation() })).rejects.toThrow('no root LICENSE')
  })
})

describe('the committed curation', () => {
  it('lists templates that all have both languages, a prompt and a known category', async () => {
    const committed = JSON.parse(await fs.readFile(path.join(import.meta.dir, 'curation.json'), 'utf-8')) as Curation
    const entries = Object.entries(committed.templates)
    expect(entries.length).toBeGreaterThanOrEqual(8)
    for (const [id, template] of entries) {
      expect(['web', 'prototype'], id).toContain(template.category)
      expect(styleProblems(template.style), id).toEqual([])
      expect(template.title.en && template.title.zh && template.prompt.en && template.prompt.zh && template.descriptionZh, id).toBeTruthy()
    }
  })
})
