import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkArtifact } from '../artifactCheck.js'
import { CANVAS_ENTRY_HTML, isCanvasEntryHtml, isSafeBoardFile } from '../canvas.js'
import { DECK_ENTRY_HTML, isDeckEntryHtml, isSafeSlideId } from '../deck.js'

let root: string
let artifactsDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'artifact-check-'))
  artifactsDir = join(root, 'dc_artifacts')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function artifact(name: string, html: string | null, manifest: unknown = { version: 1, id: 'id', kind: 'page', title: 'T', entry: 'index.html' }) {
  const dir = join(artifactsDir, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'artifact.json'), JSON.stringify(manifest))
  if (html !== null) await writeFile(join(dir, 'index.html'), html)
  return dir
}

describe('checkArtifact', () => {
  test('reports nothing for a page whose local files exist', async () => {
    const dir = await artifact('ok', '<link href="style.css"><img src="img/a.png"><a href="https://x.dev">x</a><script src="data:text/javascript,1"></script>')
    await writeFile(join(dir, 'style.css'), 'body{background:url(bg.png)}')
    await mkdir(join(dir, 'img'))
    await writeFile(join(dir, 'img', 'a.png'), '')
    await writeFile(join(dir, 'bg.png'), '')
    expect(await checkArtifact(dir)).toEqual([])
  })

  test('ignores the text of a script and still checks the file of a script tag', async () => {
    const quiet = await artifact('quiet', '<script>const row = `<img src="${item.img}">`</script>')
    expect(await checkArtifact(quiet)).toEqual([])
    const missing = await artifact('missing-script', '<script src="missing.js"></script>')
    expect(await checkArtifact(missing)).toEqual(['"missing.js" does not exist.'])
  })

  test('accepts the manifest path as well as the folder', async () => {
    const dir = await artifact('ok', '<p>hi</p>')
    expect(await checkArtifact(join(dir, 'artifact.json'))).toEqual([])
  })

  test('reports a missing local file and a missing entry', async () => {
    const dir = await artifact('missing', '<img src="nope.png"><div style="background:url(gone.jpg)"></div>')
    expect((await checkArtifact(dir)).sort()).toEqual(['"gone.jpg" does not exist.', '"nope.png" does not exist.'])
    const noEntry = await artifact('noentry', null)
    expect((await checkArtifact(noEntry))[0]).toContain('entry file')
  })

  test('reports references that leave dc_artifacts', async () => {
    await writeFile(join(root, 'logo.png'), '')
    const dir = await artifact('outside', '<img src="../../logo.png">')
    const [problem] = await checkArtifact(dir)
    expect(problem).toContain('outside dc_artifacts/')
  })

  test('allows a reference to a sibling artifact inside dc_artifacts', async () => {
    await artifact('sibling', '<p>s</p>')
    const dir = await artifact('uses', '<a href="../sibling/index.html">s</a>')
    expect(await checkArtifact(dir)).toEqual([])
  })

  test('reports an invalid manifest and a folder that is not an artifact', async () => {
    const dir = await artifact('bad', '<p></p>', { kind: 'page' })
    expect((await checkArtifact(dir))[0]).toContain('version must be 1')
    expect((await checkArtifact(join(root, 'elsewhere')))[0]).toContain('not an artifact folder')
    expect((await checkArtifact(join(artifactsDir, 'absent')))[0]).toContain('does not exist')
  })

  async function system(name: string, files: string[] = ['DESIGN.md', 'tokens.css']) {
    const dir = join(artifactsDir, 'systems', name)
    await mkdir(dir, { recursive: true })
    for (const file of files) await writeFile(join(dir, file), '')
  }
  const withSystem = (reference: string) => ({ version: 1, id: 'id', kind: 'page', title: 'T', entry: 'index.html', designSystem: reference })

  test('accepts a page that links the tokens of its design system', async () => {
    await system('alpha')
    const dir = await artifact('ok', '<link rel="stylesheet" href="../systems/alpha/tokens.css">', withSystem('systems/alpha'))
    expect(await checkArtifact(dir)).toEqual([])
  })

  test('reports a page that does not link the tokens of its design system', async () => {
    await system('alpha')
    const dir = await artifact('plain', '<p>hi</p>', withSystem('systems/alpha'))
    const problems = await checkArtifact(dir)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('does not link systems/alpha/tokens.css')
  })

  test('reports a design system that is missing files', async () => {
    await system('thin', ['DESIGN.md'])
    const dir = await artifact('thin-page', '<link rel="stylesheet" href="../systems/thin/tokens.css">', withSystem('systems/thin'))
    expect(await checkArtifact(dir)).toEqual(['"../systems/thin/tokens.css" does not exist.', 'The design system "systems/thin" has no tokens.css.'])
    const gone = await artifact('gone-page', '<p>x</p>', withSystem('systems/gone'))
    expect((await checkArtifact(gone)).filter(problem => problem.startsWith('The design system'))).toEqual([
      'The design system "systems/gone" has no DESIGN.md.',
      'The design system "systems/gone" has no tokens.css.',
    ])
  })

  test('reports a designSystem that is not under systems/', async () => {
    const dir = await artifact('wrong', '<p>x</p>', withSystem('../elsewhere'))
    expect(await checkArtifact(dir)).toEqual(['designSystem "../elsewhere" must point to systems/<name> inside dc_artifacts/.'])
    const bare = await artifact('bare', '<p>x</p>', withSystem('systems'))
    expect((await checkArtifact(bare))[0]).toContain('must point to systems/<name>')
  })
})

describe('checkArtifact for a canvas', () => {
  const board = (id: string, file: string) => ({ id, file, x: 0, y: 0, width: 100, height: 100 })
  const canvasManifest = (boards: unknown[]) => ({ version: 1, id: 'c', kind: 'canvas', title: 'C', entry: 'index.html', boards })

  async function canvas(boards: unknown[], entryHtml: string = CANVAS_ENTRY_HTML, files: Record<string, string> = {}) {
    const dir = await artifact('flow', entryHtml, canvasManifest(boards))
    for (const [file, content] of Object.entries(files)) {
      await mkdir(join(dir, file, '..'), { recursive: true })
      await writeFile(join(dir, file), content)
    }
    return dir
  }

  test('accepts the fixed entry file and boards that exist', async () => {
    const dir = await canvas([board('a', 'a.html'), board('b', 'sub/b.html')], CANVAS_ENTRY_HTML, { 'a.html': '<p>a</p>', 'sub/b.html': '<p>b</p>' })
    expect(await checkArtifact(dir)).toEqual([])
  })

  test('reports an entry file that is not the canvas entry file', async () => {
    const dir = await canvas([], '<p>my own page</p>')
    expect((await checkArtifact(dir))[0]).toContain('must be exactly the canvas entry file')
  })

  test('reports a missing board file, a repeated id and a board whose page references a missing file', async () => {
    const dir = await canvas([board('a', 'a.html'), board('a', 'gone.html'), board('c', 'c.html')], CANVAS_ENTRY_HTML, { 'a.html': '<p>a</p>', 'c.html': '<img src="nope.png">' })
    expect((await checkArtifact(dir)).sort()).toEqual([
      'Board "a": file "gone.html" does not exist.',
      'Board id "a" is used twice.',
      'Board "c": "nope.png" does not exist.',
    ].sort())
  })

  test('reports board files that are absolute, have a protocol or climb out of the folder', async () => {
    const dir = await canvas([board('a', '/etc/passwd'), board('b', 'https://example.com/x.html'), board('c', '../other/c.html'), board('d', 'C:\\x.html')])
    const problems = await checkArtifact(dir)
    expect(problems).toHaveLength(4)
    expect(problems.every(problem => problem.includes('relative path inside the artifact folder'))).toBe(true)
  })

  test('checks that a board page links the design system tokens', async () => {
    const dir = join(artifactsDir, 'flow')
    await mkdir(join(artifactsDir, 'systems', 'alpha'), { recursive: true })
    await writeFile(join(artifactsDir, 'systems', 'alpha', 'DESIGN.md'), '')
    await writeFile(join(artifactsDir, 'systems', 'alpha', 'tokens.css'), '')
    await artifact('flow', CANVAS_ENTRY_HTML, { ...canvasManifest([board('a', 'a.html')]), designSystem: 'systems/alpha' })
    await writeFile(join(dir, 'a.html'), '<p>no link</p>')
    expect((await checkArtifact(dir)).some(problem => problem.includes('does not link systems/alpha/tokens.css'))).toBe(true)
    await writeFile(join(dir, 'a.html'), '<link rel="stylesheet" href="../systems/alpha/tokens.css">')
    expect(await checkArtifact(dir)).toEqual([])
  })
})

describe('canvas helpers', () => {
  test('the entry file check ignores whitespace and nothing else', () => {
    expect(isCanvasEntryHtml(CANVAS_ENTRY_HTML)).toBe(true)
    expect(isCanvasEntryHtml(CANVAS_ENTRY_HTML.replace(/\n/g, '\r\n  '))).toBe(true)
    expect(isCanvasEntryHtml(CANVAS_ENTRY_HTML.replace('canvas.js', 'evil.js'))).toBe(false)
    expect(isCanvasEntryHtml(CANVAS_ENTRY_HTML.replace('</body>', '<p>x</p></body>'))).toBe(false)
  })

  test('board files must be plain relative paths', () => {
    expect(['a.html', 'sub/a.html', 'a b.html'].every(isSafeBoardFile)).toBe(true)
    expect(['', '/a.html', '\\a.html', 'C:/a.html', 'https://x/a.html', 'data:text/html,x', '../a.html', 'a/../../b.html', 'a\\..\\b.html', 'a\0.html'].some(isSafeBoardFile)).toBe(false)
  })
})


describe('checkArtifact for a deck', () => {
  const deckManifest = (slides: unknown, extra: Record<string, unknown> = {}) => ({ version: 1, id: 'd', kind: 'deck', title: 'D', entry: 'index.html', slides, ...extra })
  const slide = (body: string) => `<section class="slide">${body}</section>\n`

  async function deck(slides: unknown, files: Record<string, string>, options: { entryHtml?: string; extra?: Record<string, unknown> } = {}) {
    const dir = await artifact('talk', options.entryHtml ?? DECK_ENTRY_HTML, deckManifest(slides, options.extra))
    for (const [file, content] of Object.entries({ 'deck.css': '', ...files })) {
      await mkdir(join(dir, file, '..'), { recursive: true })
      await writeFile(join(dir, file), content)
    }
    return dir
  }

  test('accepts the fixed entry file, deck.css and slides that exist', async () => {
    const dir = await deck(['cover', 'agenda'], { 'slides/cover.html': slide('<h1>Hi</h1>'), 'slides/agenda.html': slide('<ul><li>a</li></ul>') })
    expect(await checkArtifact(dir)).toEqual([])
  })

  test('reports an entry file that is not the deck entry file and a missing deck.css', async () => {
    const dir = await artifact('talk', '<p>mine</p>', deckManifest([]))
    expect(await checkArtifact(dir)).toEqual([
      'The entry file "index.html" of a deck must be exactly the deck entry file from the artifacts skill.',
      'deck.css does not exist.',
    ])
  })

  test('reports slide ids that are not allowed, repeated or without a file', async () => {
    const dir = await deck(['cover', '../cover', 'cover', 'gone'], { 'slides/cover.html': slide('x') })
    expect(await checkArtifact(dir)).toEqual([
      'Slide id "../cover" may only use letters, digits, "_" and "-", and at most 64 characters.',
      'Slide id "cover" is used twice.',
      'Slide "gone": slides/gone.html does not exist.',
    ])
  })

  test('reports a slide that is not one section, has a script or an inline event attribute', async () => {
    const dir = await deck(['page', 'two', 'nested', 'script', 'event', 'text'], {
      'slides/page.html': '<!doctype html><html><body><section>x</section></body></html>',
      'slides/two.html': '<section>one</section>\n<section>two</section>\n',
      'slides/nested.html': slide('<section class="inner"><p>inside</p></section><section>again</section>'),
      'slides/script.html': slide('<script>alert(1)</script>'),
      'slides/event.html': slide('<button onclick="go()">go</button>'),
      'slides/text.html': slide('<p>turn it on = done</p>'),
    })
    expect(await checkArtifact(dir)).toEqual([
      'Slide "page": the file must hold exactly one <section> element and nothing before or after it.',
      'Slide "two": the file must hold exactly one <section> element and nothing before or after it.',
      'Slide "script": a slide cannot contain <script>. Put content that needs a script into an embedded page and show it with <iframe src="embeds/...">.',
      'Slide "event": a slide cannot use inline event attributes such as onclick.',
    ])
  })

  test('resolves what a slide references from the artifact folder, not from slides/', async () => {
    const dir = await deck(['cover', 'wrong'], {
      'slides/cover.html': slide('<img src="assets/chart.png"><iframe src="embeds/demo.html"></iframe>'),
      'slides/wrong.html': slide('<img src="../assets/chart.png">'),
      'assets/chart.png': '',
      'embeds/demo.html': '<script src="lib.js"></script><img src="../assets/chart.png">',
      'embeds/lib.js': '',
    })
    expect(await checkArtifact(dir)).toEqual(['Slide "wrong": "../assets/chart.png" does not exist.'])
  })

  test('resolves what deck.css and an embedded page reference from their own location', async () => {
    const dir = await deck(['cover'], {
      'deck.css': '.cover{background:url(assets/bg.png)} .x{background:url(assets/gone.png)}',
      'slides/cover.html': slide('<iframe src="embeds/demo.html"></iframe>'),
      'assets/bg.png': '',
      'embeds/demo.html': '<img src="assets/bg.png">',
    })
    expect(await checkArtifact(dir)).toEqual(['deck.css: "assets/gone.png" does not exist.', 'embeds/demo.html: "assets/bg.png" does not exist.'])
  })

  test('reports an embedded page that is outside the folder of the deck or missing', async () => {
    await artifact('other', '<p>o</p>')
    const dir = await deck(['cover'], { 'slides/cover.html': slide('<iframe src="../other/index.html"></iframe><iframe src="embeds/gone.html"></iframe><iframe src="https://example.com/"></iframe>') })
    expect(await checkArtifact(dir)).toEqual([
      'Slide "cover": "embeds/gone.html" does not exist.',
      `Slide "cover": the embedded page "../other/index.html" must be inside this artifact's folder.`,
    ])
  })

  test('reports a slide file that the manifest does not list', async () => {
    const dir = await deck(['cover'], { 'slides/cover.html': slide('x'), 'slides/draft.html': slide('y'), 'slides/notes.txt': '' })
    expect(await checkArtifact(dir)).toEqual(['slides/draft.html is not listed in "slides" of artifact.json, so it is not shown.'])
  })

  test('checks that the design system of a deck exists without asking the entry to link its tokens', async () => {
    await mkdir(join(artifactsDir, 'systems', 'alpha'), { recursive: true })
    await writeFile(join(artifactsDir, 'systems', 'alpha', 'DESIGN.md'), '')
    const dir = await deck(['cover'], { 'slides/cover.html': slide('x') }, { extra: { designSystem: 'systems/alpha' } })
    expect(await checkArtifact(dir)).toEqual(['The design system "systems/alpha" has no tokens.css.'])
    await writeFile(join(artifactsDir, 'systems', 'alpha', 'tokens.css'), '')
    expect(await checkArtifact(dir)).toEqual([])
  })
})

describe('deck helpers', () => {
  test('the entry file check ignores whitespace and nothing else', () => {
    expect(isDeckEntryHtml(DECK_ENTRY_HTML)).toBe(true)
    expect(isDeckEntryHtml(DECK_ENTRY_HTML.replace(/\n/g, '\r\n  '))).toBe(true)
    expect(isDeckEntryHtml(DECK_ENTRY_HTML.replace('deck.js', 'canvas.js'))).toBe(false)
    expect(isDeckEntryHtml(DECK_ENTRY_HTML.replace('</body>', '<link rel="stylesheet" href="deck.css"></body>'))).toBe(false)
  })

  test('slide ids are short names of letters, digits, underscore and hyphen', () => {
    expect(['cover', 'Q3_plan-2', 'a'.repeat(64)].every(isSafeSlideId)).toBe(true)
    expect(['', 'a b', 'a/b', '../a', 'a.html', 'é', 'a'.repeat(65)].some(isSafeSlideId)).toBe(false)
  })
})
