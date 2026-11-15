import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { checkArtifact } from '../../src/utils/artifactCheck.js'
import { ARTIFACTS_DIRNAME, ARTIFACT_MANIFEST_FILE, isSafeArtifactName, newArtifactId, parseArtifactManifest, type ArtifactManifest } from '../../src/utils/artifacts.js'
import { ARTIFACT_SHELL_DIRNAME, ARTIFACT_SHELL_FILES, ARTIFACT_SHELL_PREFIX } from '../../src/utils/artifactShell.js'
import { BUNDLED_CATALOG_FILE, directoryExists, fileExists, type BundledLicense } from '../../src/utils/bundledContent.js'
import { DECK_ENTRY_HTML, DECK_HEIGHT, DECK_STYLESHEET_FILE, DECK_WIDTH, slideFile } from '../../src/utils/deck.js'
import type { DesignTemplateCatalog, DesignTemplateRecord } from '../../src/utils/designTemplates.js'
import { holderOf, option, parseLicense, readIfExists, sourceCommit } from '../lib/bundle.js'
import { launchChrome, type ChromePage } from '../lib/headlessChrome.js'
import { mergeCatalog, readExistingCatalog, styleProblems } from './convert.js'
import { dedent, dropWindowMedia, scaleLengths, scaleStyleAttributes, stripCssComments, tidyCss } from './slideCss.js'

export const SLIDE_DOC_FILE = 'DESIGN.md'
const SOURCE_TEMPLATES_DIR = 'templates'
const SOURCE_HTML = 'template.html'
const SOURCE_META = 'template.json'
const SOURCE_DOC = 'design.md'
const LICENSE_COPY = 'LICENSE-beautiful-html-templates.txt'
const ROOT_FONT_SIZE = 16

export type SlideTemplateCuration = {
  selector: string
  factor: number
  title: { zh: string }
  descriptionZh: string
  style: { en: string; zh: string }
}

export type SlideCuration = {
  sourceRepo: string
  templates: Record<string, SlideTemplateCuration>
}

export type SourceMeta = {
  name: string
  tagline: string
  mood: string[]
  scheme: string
}

export const SLIDE_TEMPLATE_PROMPT = {
  en: 'Keep deck.css, the fonts, the colors, the decoration and the kinds of slide of the example. Replace every text, name, number and date with the user\'s content, drop the slides the deck does not need from the slides list and delete their files, and copy the file of a slide of the same kind for each further slide of that kind. A layout the template lacks is built from its own fonts, colors and decoration. Page numbers come from the stage counters and are never typed; section numbers are content, so renumber them for the sections of the new deck.',
  zh: '保留示例的 deck.css、字体、配色、装饰和页面种类。把所有文字、名字、数字和日期换成用户的内容；用不到的页从 slides 列表里去掉并删除文件，同一种页需要更多时复制一个同种页面的文件。模板没有的版式用它自己的字体、配色和装饰来做。页码来自舞台的计数器，不要写进页面；章节号是内容，按新幻灯片的章节重新编号。',
}

export const SLIDE_DOC_NOTICE = [
  '> This design note comes from [beautiful-html-templates](https://github.com/zarazhangrui/beautiful-html-templates) (MIT, Copyright (c) 2026 Zara Zhang). The template in this folder was converted to the DreamCoder deck format: a fixed 1920 by 1080 stage, one file per slide under slides/, all styles in deck.css, no scripts in slides, and page numbers from the stage counters. Where this note talks about viewport units, navigation, slide counters, scripts or a single HTML file, the deck format wins; colors, type and decoration are as described here.',
  '',
  '',
].join('\n')

export function withNotice(doc: string): string {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(doc)?.[0] ?? ''
  return `${frontmatter}${frontmatter ? '\n' : ''}${SLIDE_DOC_NOTICE}${doc.slice(frontmatter.length).replace(/^\s+/, '')}`
}

type Extracted = {
  styles: string[]
  fonts: string[]
  slides: Array<{ html: string; classes: string[]; heading: string }>
}

function extractInPage(input: { html: string; selector: string; factor: number }): Extracted {
  const doc = new DOMParser().parseFromString(input.html, 'text/html')
  for (const node of doc.querySelectorAll('script, noscript')) node.remove()
  const comments = doc.createNodeIterator(doc, NodeFilter.SHOW_COMMENT)
  const found: Node[] = []
  for (let node = comments.nextNode(); node; node = comments.nextNode()) found.push(node)
  for (const node of found) node.parentNode?.removeChild(node)
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || /^data-(slide|index|page|label|om-)/i.test(attribute.name)) element.removeAttribute(attribute.name)
    }
  }
  const styles = [...doc.querySelectorAll('style')].map(style => style.textContent ?? '')
  const fonts = [...doc.querySelectorAll('link[rel~="stylesheet"][href]')].map(link => link.getAttribute('href') ?? '')
  const slides = [...doc.querySelectorAll(input.selector)].map((element) => {
    let section = element
    if (element.localName !== 'section') {
      section = doc.createElement('section')
      for (const attribute of [...element.attributes]) section.setAttribute(attribute.name, attribute.value)
      while (element.firstChild) section.appendChild(element.firstChild)
    }
    section.classList.remove('active')
    if (section.classList.length === 0) section.removeAttribute('class')
    for (const node of section.querySelectorAll('svg, img')) {
      if (node.localName === 'svg' && node.parentElement?.closest('svg')) continue
      for (const name of ['width', 'height']) {
        const value = node.getAttribute(name)
        if (value && /^\d+(\.\d+)?$/.test(value)) node.setAttribute(name, String(Number(value) * input.factor))
      }
    }
    return { html: section.outerHTML, classes: [...section.classList], heading: section.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim() ?? '' }
  })
  return { styles, fonts, slides }
}

function slug(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
}

export function slideIdsFor(slides: ReadonlyArray<{ classes: string[]; heading: string }>): string[] {
  const used = new Set<string>()
  return slides.map((slide, index) => {
    const kind = slide.classes.map(name => /^(?:slide--|slide-|s-|layout-)(.+)$/.exec(name)?.[1]).find(name => name && !/^\d+$/.test(name))
    const base = slug(kind ?? '') || slug(slide.heading) || `slide-${index + 1}`
    let id = base
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`
    used.add(id)
    return id
  })
}

export function deckCssFrom(extracted: Pick<Extracted, 'styles' | 'fonts'>, factor: number): string {
  const imports = extracted.fonts.filter(Boolean).map(url => `@import url("${url}");`).join('\n')
  const body = dropWindowMedia(stripCssComments(extracted.styles.join('\n')))
  return `${[imports, tidyCss(scaleLengths(body, { factor, rootFontSize: ROOT_FONT_SIZE }))].filter(Boolean).join('\n\n')}\n`
}

export function draftReport(css: string, slides: ReadonlyArray<{ id: string; html: string }>): string[] {
  const notes: string[] = []
  const check = (pattern: RegExp, text: string, what: string) => {
    if (pattern.test(text)) notes.push(what)
  }
  check(/(^|[\s,}])(html|body)\s*[{,]/m, css, `${DECK_STYLESHEET_FILE}: rules for html or body`)
  check(/#[A-Za-z][\w-]*/, css.replace(/\{[^{}]*\}/g, '{}'), `${DECK_STYLESHEET_FILE}: selectors by #id`)
  check(/\.active\b/, css, `${DECK_STYLESHEET_FILE}: rules that depend on .active`)
  check(/position:\s*fixed/, css, `${DECK_STYLESHEET_FILE}: position: fixed`)
  check(/opacity:\s*0\s*[;}]/, css, `${DECK_STYLESHEET_FILE}: elements hidden with opacity 0`)
  check(/\b(?:counter-reset|counter-increment)\b/, css, `${DECK_STYLESHEET_FILE}: its own counters`)
  for (const slide of slides) {
    check(/\b(?:\d{1,2} \/ \d{1,2}|0\d\s*\/\s*\d{2})\b/, slide.html.replace(/<[^>]+>/g, ' '), `${slide.id}: text like "03 / 12"`)
    check(/\sid="/, slide.html, `${slide.id}: elements with an id`)
  }
  return notes
}

const MIN_FONT_PX = 20
const BLOCKING_NOTES = ['rules for html or body', 'selectors by #id', 'rules that depend on .active', 'position: fixed', 'text like "03 / 12"']

export function finishProblems(css: string, slides: ReadonlyArray<{ id: string; html: string }>): string[] {
  const small = [...`${css}\n${slides.map(slide => slide.html).join('\n')}`.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
    .map(match => Number(match[1]))
    .filter(size => size < MIN_FONT_PX)
  return [
    ...draftReport(css, slides).filter(note => BLOCKING_NOTES.some(blocking => note.endsWith(blocking))),
    ...slides.filter(slide => /<style[\s>]/i.test(slide.html)).map(slide => `${slide.id}: a <style> element, its rules belong in ${DECK_STYLESHEET_FILE}`),
    ...(small.length > 0 ? [`font sizes under ${MIN_FONT_PX}px: ${[...new Set(small)].join(', ')}`] : []),
  ]
}

const TEMPLATE_ENTRIES = new Set([ARTIFACT_MANIFEST_FILE, 'index.html', DECK_STYLESHEET_FILE, SLIDE_DOC_FILE, 'slides', 'embeds', 'assets'])

export async function templateProblems(folder: string, id: string): Promise<string[]> {
  const stray = (await readdir(folder).catch(() => [])).filter(entry => !TEMPLATE_ENTRIES.has(entry))
  const manifest = parseArtifactManifest(await readFile(join(folder, ARTIFACT_MANIFEST_FILE), 'utf-8').catch(() => '')).manifest
  if (manifest?.kind !== 'deck' || !manifest.slides) return ['artifact.json is not a deck']
  const slides = await Promise.all(manifest.slides.map(async slide => ({ id: slide, html: await readFile(join(folder, slideFile(slide)), 'utf-8').catch(() => '') })))
  return [
    ...stray.map(entry => `${entry} is not part of a deck template`),
    ...(await deckProblems(folder, id)),
    ...finishProblems(await readFile(join(folder, DECK_STYLESHEET_FILE), 'utf-8').catch(() => ''), slides),
  ]
}

export async function draftTemplate(page: ChromePage, sourceFolder: string, target: string, curation: SlideTemplateCuration, meta: SourceMeta): Promise<string[]> {
  const html = await readFile(join(sourceFolder, SOURCE_HTML), 'utf-8')
  const extracted = await page.evaluate<Extracted>(`(${extractInPage.toString()})(${JSON.stringify({ html, selector: curation.selector, factor: curation.factor })})`)
  if (extracted.slides.length === 0) throw new Error(`No slide matches ${curation.selector}`)
  const ids = slideIdsFor(extracted.slides)
  const css = deckCssFrom(extracted, curation.factor)
  const slides = extracted.slides.map((slide, index) => ({ id: ids[index]!, html: `${dedent(scaleStyleAttributes(slide.html, { factor: curation.factor, rootFontSize: ROOT_FONT_SIZE }), 1)}\n` }))
  await mkdir(join(target, 'slides'), { recursive: true })
  await writeFile(join(target, DECK_STYLESHEET_FILE), css, 'utf-8')
  for (const slide of slides) await writeFile(join(target, slideFile(slide.id)), slide.html, 'utf-8')
  const manifest: ArtifactManifest = { version: 1, id: newArtifactId(), kind: 'deck', title: meta.name, entry: 'index.html', slides: ids }
  await writeFile(join(target, ARTIFACT_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
  await writeFile(join(target, 'index.html'), DECK_ENTRY_HTML, 'utf-8')
  return draftReport(css, slides)
}

export function buildSlideRecord(id: string, meta: SourceMeta, curation: SlideTemplateCuration, license: BundledLicense, repo: string, commit: string): DesignTemplateRecord {
  const style = styleProblems(curation.style)
  if (style.length > 0) throw new Error(`${id}: ${style.join('; ')}`)
  if (!curation.title.zh || !curation.descriptionZh) throw new Error(`${id}: no Chinese title or description`)
  return {
    id,
    category: 'slides',
    platform: null,
    scenario: null,
    entry: 'index.html',
    acceptsDesignSystem: false,
    params: [],
    prompt: SLIDE_TEMPLATE_PROMPT,
    title: { en: meta.name, zh: curation.title.zh },
    description: { en: meta.tagline, zh: curation.descriptionZh },
    tags: [...meta.mood, meta.scheme].filter(Boolean),
    style: curation.style,
    license,
    author: holderOf(license.copyright),
    source: { repo, commit, path: `${SOURCE_TEMPLATES_DIR}/${id}` },
  }
}

async function readMeta(folder: string): Promise<SourceMeta> {
  const meta = JSON.parse(await readFile(join(folder, SOURCE_META), 'utf-8')) as SourceMeta
  if (!meta.name || !meta.tagline) throw new Error(`${folder}: ${SOURCE_META} has no name or tagline`)
  return meta
}

async function deckProblems(folder: string, id: string): Promise<string[]> {
  const work = await mkdtemp(join(tmpdir(), 'slide-template-check-'))
  try {
    const copy = join(work, ARTIFACTS_DIRNAME, id)
    await cp(folder, copy, { recursive: true })
    return await checkArtifact(copy)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

export type ApplyOptions = {
  sourceDir: string
  curation: SlideCuration
  outDir: string
  commit: string
}

export async function applySlideTemplates(options: ApplyOptions): Promise<DesignTemplateCatalog> {
  const sourceRoot = resolve(options.sourceDir)
  const licenseText = await readIfExists(join(sourceRoot, 'LICENSE'))
  if (!licenseText) throw new Error('The source repository has no root LICENSE')
  const parsed = parseLicense(licenseText)
  const license: BundledLicense = { id: parsed.id, file: null, copyright: parsed.copyright }
  const outDir = resolve(options.outDir)
  const records: DesignTemplateRecord[] = []
  for (const [id, curation] of Object.entries(options.curation.templates)) {
    const source = join(sourceRoot, SOURCE_TEMPLATES_DIR, id)
    const folder = join(outDir, id)
    if (!(await directoryExists(folder))) throw new Error(`${id}: run the draft step first, ${folder} does not exist`)
    const meta = await readMeta(source)
    const manifest = parseArtifactManifest(await readFile(join(folder, ARTIFACT_MANIFEST_FILE), 'utf-8')).manifest
    if (manifest?.kind !== 'deck' || !manifest.slides) throw new Error(`${id}: artifact.json is not a deck`)
    await writeFile(join(folder, ARTIFACT_MANIFEST_FILE), `${JSON.stringify({ ...manifest, title: meta.name }, null, 2)}\n`, 'utf-8')
    await writeFile(join(folder, 'index.html'), DECK_ENTRY_HTML, 'utf-8')
    await writeFile(join(folder, SLIDE_DOC_FILE), withNotice(await readFile(join(source, SOURCE_DOC), 'utf-8')), 'utf-8')
    const problems = await templateProblems(folder, id)
    if (problems.length > 0) throw new Error(`${id}: ${problems.join('; ')}`)
    records.push(buildSlideRecord(id, meta, curation, license, options.curation.sourceRepo, options.commit))
  }
  const catalog = mergeCatalog(await readExistingCatalog(outDir), records, category => category === 'slides')
  await writeFile(join(outDir, BUNDLED_CATALOG_FILE), `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8')
  await writeFile(join(outDir, LICENSE_COPY), licenseText, 'utf-8')
  return catalog
}

export function serveDeck(folder: string, shellDir: string): { url: string; stop: () => void } {
  const root = resolve(folder)
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname)
      if (path.startsWith(ARTIFACT_SHELL_PREFIX)) {
        const name = path.slice(ARTIFACT_SHELL_PREFIX.length)
        return ARTIFACT_SHELL_FILES.includes(name) ? new Response(Bun.file(join(shellDir, name))) : new Response('Not found', { status: 404 })
      }
      const file = resolve(root, `.${path === '/' ? '/index.html' : path}`)
      if (relative(root, file).startsWith('..') || file.includes(`${sep}..${sep}`)) return new Response('Not found', { status: 404 })
      return (await fileExists(file)) ? new Response(Bun.file(file)) : new Response('Not found', { status: 404 })
    },
  })
  return { url: `http://127.0.0.1:${server.port}/index.html`, stop: () => server.stop(true) }
}

async function settle(page: ChromePage) {
  await page.evaluate(`(async () => {
    await window.__dreamcoderDeck.prepareCapture()
    await document.fonts.ready
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish()
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  })()`)
}

export async function openDeck(page: ChromePage, url: string): Promise<string[]> {
  await page.setViewport(DECK_WIDTH, DECK_HEIGHT)
  await page.goto(url)
  const ids = await page.evaluate<string[]>(`(async () => {
    for (let tries = 0; tries < 200; tries++) {
      const deck = window.__dreamcoderDeck
      if (deck && deck.state().count > 0) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return fetch('artifact.json').then((response) => response.json()).then((manifest) => manifest.slides)
  })()`)
  await settle(page)
  return ids
}

export async function shootSlide(page: ChromePage, id: string): Promise<Uint8Array> {
  await page.evaluate(`window.__dreamcoderDeck.goTo(${JSON.stringify(id)})`)
  await settle(page)
  return page.screenshot({ x: 0, y: 0, width: DECK_WIDTH, height: DECK_HEIGHT })
}

async function shots(outDir: string, ids: string[], shellDir: string, target: string) {
  const chrome = await launchChrome()
  try {
    for (const id of ids) {
      const server = serveDeck(join(outDir, id), shellDir)
      try {
        const page = await chrome.newPage()
        const slides = await openDeck(page, server.url)
        const folder = join(target, id)
        await mkdir(folder, { recursive: true })
        const overflow = await page.evaluate<unknown[]>('window.__dreamcoderDeck.overflow()')
        await writeFile(join(folder, 'overflow.json'), `${JSON.stringify(overflow, null, 2)}\n`, 'utf-8')
        for (const [index, slide] of slides.entries()) {
          await writeFile(join(folder, `${String(index + 1).padStart(2, '0')}-${slide}.png`), await shootSlide(page, slide))
        }
        console.log(`${id}: ${slides.length} slides, ${overflow.length} with overflow`)
      } finally {
        server.stop()
      }
    }
  } finally {
    await chrome.close()
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const here = import.meta.dir
  const desktop = join(here, '..', '..', 'desktop')
  const outDir = join(desktop, 'design-templates')
  const shellDir = join(desktop, 'public', ARTIFACT_SHELL_DIRNAME)
  const curation = JSON.parse(await readFile(join(here, 'slide-curation.json'), 'utf-8')) as SlideCuration
  const ids = args.filter(arg => !arg.startsWith('--') && arg !== option(args, '--source') && arg !== option(args, '--out'))
  const wanted = ids.length > 0 ? ids : Object.keys(curation.templates)
  for (const id of wanted) {
    if (!curation.templates[id] || !isSafeArtifactName(id)) throw new Error(`${id} is not in slide-curation.json`)
  }
  if (command === 'draft') {
    const source = option(args, '--source')
    if (!source) throw new Error('Usage: bun run scripts/design-templates/slides.ts draft --source <beautiful-html-templates checkout> [--out <folder>] [--force] [id...]')
    const chrome = await launchChrome()
    try {
      const page = await chrome.newPage()
      for (const id of wanted) {
        const target = join(resolve(option(args, '--out') ?? outDir), id)
        if ((await directoryExists(target)) && !args.includes('--force')) throw new Error(`${target} exists; pass --force to replace it`)
        await rm(target, { recursive: true, force: true })
        const sourceFolder = join(resolve(source), SOURCE_TEMPLATES_DIR, id)
        const notes = await draftTemplate(page, sourceFolder, target, curation.templates[id]!, await readMeta(sourceFolder))
        console.log(`${id}: drafted${notes.length > 0 ? `\n  - ${notes.join('\n  - ')}` : ''}`)
      }
    } finally {
      await chrome.close()
    }
    return
  }
  if (command === 'apply') {
    const source = option(args, '--source')
    if (!source) throw new Error('Usage: bun run scripts/design-templates/slides.ts apply --source <beautiful-html-templates checkout>')
    const catalog = await applySlideTemplates({ sourceDir: source, curation, outDir, commit: sourceCommit(source) })
    console.log(`Catalog has ${catalog.templates.filter(template => template.category === 'slides').length} slide templates`)
    return
  }
  if (command === 'check') {
    let failed = false
    for (const id of wanted) {
      const problems = await templateProblems(join(outDir, id), id)
      failed ||= problems.length > 0
      console.log(problems.length === 0 ? `${id}: ok` : `${id}:\n  - ${problems.join('\n  - ')}`)
    }
    if (failed) process.exitCode = 1
    return
  }
  if (command === 'shots') {
    const target = option(args, '--out')
    if (!target) throw new Error('Usage: bun run scripts/design-templates/slides.ts shots --out <folder> [id...]')
    await shots(outDir, wanted, shellDir, resolve(target))
    return
  }
  throw new Error('Usage: bun run scripts/design-templates/slides.ts draft|check|apply|shots ...')
}

if (import.meta.main) await main()
