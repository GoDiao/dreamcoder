import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { DECK_ENTRY_HTML } from '../../src/utils/deck.js'
import type { DesignTemplateRecord } from '../../src/utils/designTemplates.js'
import {
  applySlideTemplates,
  buildSlideRecord,
  deckCssFrom,
  draftReport,
  finishProblems,
  SLIDE_DOC_NOTICE,
  slideIdsFor,
  withNotice,
  type SlideCuration,
  type SlideTemplateCuration,
  type SourceMeta,
} from './slides'

const MIT = `MIT License

Copyright (c) 2026 Zara Zhang

Permission is hereby granted`
const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const META: SourceMeta = { name: 'Poster', tagline: 'A loud poster.', mood: ['bold', 'loud'], scheme: 'light' }
const LICENSE = { id: 'MIT', file: null, copyright: 'Copyright (c) 2026 Zara Zhang' }

function curation(overrides: Partial<SlideTemplateCuration> = {}): SlideTemplateCuration {
  return {
    selector: '.slide',
    factor: 2,
    title: { zh: '海报' },
    descriptionZh: '响亮的海报。',
    style: { en: 'Loud and red.', zh: '响亮的红色。' },
    ...overrides,
  }
}

let root: string
let source: string
let out: string

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function writeSource(id: string) {
  await write(path.join(source, 'templates', id, 'template.json'), JSON.stringify(META))
  await write(path.join(source, 'templates', id, 'design.md'), '---\nname: Poster\n---\n\n# Poster\n\nUse vw for type.\n')
}

async function writeDeck(id: string, slides: Record<string, string>) {
  await write(path.join(out, id, 'artifact.json'), JSON.stringify({ version: 1, id: '00000000-0000-4000-8000-000000000001', kind: 'deck', title: 'Old', entry: 'index.html', slides: Object.keys(slides) }))
  await write(path.join(out, id, 'deck.css'), '.slide { padding: 96px; }\n')
  for (const [slide, html] of Object.entries(slides)) await write(path.join(out, id, 'slides', `${slide}.html`), html)
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-templates-'))
  source = path.join(root, 'upstream')
  out = path.join(root, 'out')
  await write(path.join(source, 'LICENSE'), MIT)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('the draft step', () => {
  it('names slides after their kind class or heading, never twice', () => {
    expect(slideIdsFor([
      { classes: ['slide', 'slide-hero'], heading: '' },
      { classes: ['slide', 's-cover'], heading: '' },
      { classes: ['slide', 'slide--quote'], heading: '' },
      { classes: ['slide', 'slide-1'], heading: 'Our Plan' },
      { classes: ['slide', 'slide-hero'], heading: '' },
      { classes: ['slide'], heading: '' },
    ])).toEqual(['hero', 'cover', 'quote', 'our-plan', 'hero-2', 'slide-6'])
  })

  it('turns the font links into imports and the page styles into frame pixels without small-window rules', () => {
    const css = deckCssFrom({
      fonts: ['https://fonts.googleapis.com/css2?family=Shrikhand'],
      styles: ['    /* nav */\n    .title { font-size: clamp(32px, 7vw, 90px); }\n    @media (max-width: 768px) { .title { font-size: 20px; } }'],
    }, 2)
    expect(css).toBe('@import url("https://fonts.googleapis.com/css2?family=Shrikhand");\n\n.title { font-size: 134px; }\n')
  })

  it('reports what the cleanup still has to change', () => {
    const notes = draftReport('html, body { color: #fff; }\n#deck { x: y }\n.slide.active { opacity: 1 }\n.nav { position: fixed; }\n.slide { opacity: 0; }\n.list { counter-reset: n; }', [
      { id: 'cover', html: '<section><p>01 / 09</p><b id="x"></b></section>' },
    ])
    expect(notes).toEqual([
      'deck.css: rules for html or body',
      'deck.css: selectors by #id',
      'deck.css: rules that depend on .active',
      'deck.css: position: fixed',
      'deck.css: elements hidden with opacity 0',
      'deck.css: its own counters',
      'cover: text like "03 / 12"',
      'cover: elements with an id',
    ])
    expect(draftReport('.a { color: #fff; background: linear-gradient(#abcdef, #fed 40%); }\n@media (prefers-reduced-motion: reduce) { .a { border-color: #ace; } }', [{ id: 'a', html: '<section><p>2026</p></section>' }])).toEqual([])
    expect(draftReport('', [{ id: 'a', html: '<section><p>a 50/50 split, 3/4 done</p></section>' }])).toEqual([])
    expect(draftReport('', [{ id: 'a', html: '<section><p>07/12</p></section>' }])).toEqual(['a: text like "03 / 12"'])
  })
})

describe('finishProblems', () => {
  it('blocks what the stage or the format forbids and type under 20px, and lets the rest through', () => {
    expect(finishProblems('html { color: red; }\n.nav { position: fixed; }\n.tag { font-size: 14px; }', [
      { id: 'cover', html: '<section><p>02 / 10</p><span style="font-size: 12px">x</span></section>' },
    ])).toEqual([
      'deck.css: rules for html or body',
      'deck.css: position: fixed',
      'cover: text like "03 / 12"',
      'font sizes under 20px: 14, 12',
    ])
    expect(finishProblems('.list { counter-reset: n; } .x { opacity: 0; font-size: 20px; }', [{ id: 'a', html: '<section id="a"></section>' }])).toEqual([])
    expect(finishProblems('', [{ id: 'logo', html: '<section><svg><style>.cls-0{fill:red}</style></svg></section>' }])).toEqual(['logo: a <style> element, its rules belong in deck.css'])
  })
})

describe('the catalog record of a slide template', () => {
  it('takes the name, tagline and mood from upstream and the Chinese text and style from the curation', () => {
    const record = buildSlideRecord('poster', META, curation(), LICENSE, 'https://example.com/upstream', COMMIT)
    expect(record).toMatchObject({
      id: 'poster',
      category: 'slides',
      platform: null,
      entry: 'index.html',
      acceptsDesignSystem: false,
      title: { en: 'Poster', zh: '海报' },
      description: { en: 'A loud poster.', zh: '响亮的海报。' },
      tags: ['bold', 'loud', 'light'],
      author: 'Zara Zhang',
      source: { repo: 'https://example.com/upstream', commit: COMMIT, path: 'templates/poster' },
    })
  })

  it('needs a one-line style and a Chinese title and description', () => {
    expect(() => buildSlideRecord('poster', META, curation({ style: { en: 'x', zh: '' } }), LICENSE, 'r', COMMIT)).toThrow('style')
    expect(() => buildSlideRecord('poster', META, curation({ descriptionZh: '' }), LICENSE, 'r', COMMIT)).toThrow('no Chinese')
  })

  it('puts the notice after the front matter of the design note', () => {
    expect(withNotice('---\nname: x\n---\n\n# X')).toBe(`---\nname: x\n---\n\n${SLIDE_DOC_NOTICE}# X`)
    expect(withNotice('# X')).toBe(`${SLIDE_DOC_NOTICE}# X`)
  })
})

describe('applySlideTemplates', () => {
  const run = (templates: Record<string, SlideTemplateCuration>) =>
    applySlideTemplates({ sourceDir: source, curation: { sourceRepo: 'https://example.com/upstream', templates } satisfies SlideCuration, outDir: out, commit: COMMIT })

  it('finishes each converted deck, checks it and merges the records into the catalog after the other templates', async () => {
    const page = { id: 'saas', category: 'web' } as DesignTemplateRecord
    await write(path.join(out, 'catalog.json'), JSON.stringify({ version: 1, templates: [page, { id: 'gone', category: 'slides' }] }))
    await writeSource('poster')
    await writeDeck('poster', { cover: '<section class="slide"><h1>Cover</h1></section>\n' })
    const catalog = await run({ poster: curation() })

    expect(catalog.templates.map(template => template.id)).toEqual(['saas', 'poster'])
    expect(JSON.parse(await fs.readFile(path.join(out, 'catalog.json'), 'utf-8'))).toEqual(catalog)
    expect(await fs.readFile(path.join(out, 'poster', 'index.html'), 'utf-8')).toBe(DECK_ENTRY_HTML)
    expect(JSON.parse(await fs.readFile(path.join(out, 'poster', 'artifact.json'), 'utf-8'))).toMatchObject({ title: 'Poster', slides: ['cover'] })
    const doc = await fs.readFile(path.join(out, 'poster', 'DESIGN.md'), 'utf-8')
    expect(doc.startsWith('---\nname: Poster\n---\n\n> This design note comes from')).toBe(true)
    expect(doc).toContain('Use vw for type.')
    expect(await fs.readFile(path.join(out, 'LICENSE-beautiful-html-templates.txt'), 'utf-8')).toBe(MIT)
  })

  it('fails on a file that is not part of a deck template', async () => {
    await writeSource('poster')
    await writeDeck('poster', { cover: '<section class="slide"><h1>Cover</h1></section>\n' })
    await write(path.join(out, 'poster', 'deck.css.bak'), '.slide {}')
    await expect(run({ poster: curation() })).rejects.toThrow('deck.css.bak is not part of a deck template')
  })

  it('fails on a deck that does not pass the deck check, and on a template that was never drafted', async () => {
    await writeSource('poster')
    await writeDeck('poster', { cover: '<section class="slide"><script>go()</script></section>\n' })
    await expect(run({ poster: curation() })).rejects.toThrow('poster: ')
    await writeSource('ghost')
    await expect(run({ ghost: curation() })).rejects.toThrow('run the draft step first')
  })
})
