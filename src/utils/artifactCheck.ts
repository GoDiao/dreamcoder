import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  ARTIFACT_MANIFEST_FILE,
  artifactNameOf,
  artifactsDirOf,
  resolveArtifactEntryFile,
  readArtifactEntry,
  type ArtifactEntry,
  type ArtifactKind,
} from './artifacts.js'
import { isSameOrInsidePathForPlatform } from './windowsDrivePath.js'
import { pathExists } from './file.js'
import { isCanvasEntryHtml, isSafeBoardFile } from './canvas.js'
import { DECK_SLIDES_DIR, DECK_STYLESHEET_FILE, isDeckEntryHtml, isSafeSlideId, slideFile } from './deck.js'
import { DESIGN_SYSTEM_DOC_FILE, DESIGN_SYSTEM_TOKENS_FILE, designSystemsDirOf } from './designSystems.js'

const REFERENCE_PATTERN = /\b(?:src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi
const REMOTE_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

const SCRIPT_BODY_PATTERN = /(<script\b[^>]*>)[\s\S]*?<\/script>/gi
const SCRIPT_TAG_PATTERN = /<script\b/i
const EVENT_ATTRIBUTE_PATTERN = /<[^>]*\son[a-z]+\s*=/i
const IFRAME_TAG_PATTERN = /<iframe\b[^>]*>/gi
const SECTION_TAG_PATTERN = /<section\b|<\/section>/gi

export function localReferences(html: string): string[] {
  const references = new Set<string>()
  for (const match of html.replace(SCRIPT_BODY_PATTERN, '$1').matchAll(REFERENCE_PATTERN)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '').trim()
    if (!value || REMOTE_PATTERN.test(value)) continue
    references.add(value.split(/[?#]/)[0]!)
  }
  references.delete('')
  return [...references]
}

async function designSystemFileProblems(systemDir: string, reference: string): Promise<string[]> {
  const problems: string[] = []
  for (const file of [DESIGN_SYSTEM_DOC_FILE, DESIGN_SYSTEM_TOKENS_FILE]) {
    if (!(await pathExists(join(systemDir, file)))) problems.push(`The design system "${reference}" has no ${file}.`)
  }
  return problems
}

async function designSystemProblems(artifactsDir: string, reference: string, kind: ArtifactKind, linked: string[]): Promise<string[]> {
  const systemDir = resolve(artifactsDir, reference)
  if (!isSameOrInsidePathForPlatform(systemDir, designSystemsDirOf(artifactsDir)) || systemDir === designSystemsDirOf(artifactsDir)) {
    return [`designSystem "${reference}" must point to systems/<name> inside dc_artifacts/.`]
  }
  const problems = await designSystemFileProblems(systemDir, reference)
  if (kind !== 'deck' && !linked.includes(join(systemDir, DESIGN_SYSTEM_TOKENS_FILE))) {
    problems.push(`The entry page does not link ${reference}/${DESIGN_SYSTEM_TOKENS_FILE}. Add a <link rel="stylesheet"> with a relative path and use var(--*) for colors, fonts and sizes.`)
  }
  return problems
}

async function referenceProblems(text: string, baseDir: string, artifactsDir: string, linked: string[]): Promise<string[]> {
  const problems: string[] = []
  for (const reference of localReferences(text)) {
    const target = resolve(baseDir, decodeURIComponent(reference))
    linked.push(target)
    if (!isSameOrInsidePathForPlatform(target, artifactsDir)) {
      problems.push(`"${reference}" points outside dc_artifacts/. Copy the file into the artifact folder and reference it from there.`)
    } else if (!(await pathExists(target))) {
      problems.push(`"${reference}" does not exist.`)
    }
  }
  return problems
}

async function fileReferenceProblems(file: string, artifactsDir: string, linked: string[]): Promise<string[]> {
  return referenceProblems(await readFile(file, 'utf-8'), dirname(file), artifactsDir, linked)
}

async function canvasProblems(entry: ArtifactEntry, entryFile: string, linked: string[]): Promise<string[]> {
  const problems: string[] = []
  if (!isCanvasEntryHtml(await readFile(entryFile, 'utf-8'))) {
    problems.push(`The entry file "${entry.manifest?.entry}" of a canvas must be exactly the canvas entry file from the artifacts skill.`)
  }
  const seen = new Set<string>()
  for (const board of entry.manifest?.boards ?? []) {
    if (seen.has(board.id)) problems.push(`Board id "${board.id}" is used twice.`)
    seen.add(board.id)
    if (!isSafeBoardFile(board.file)) {
      problems.push(`Board "${board.id}": file "${board.file}" must be a relative path inside the artifact folder, without a protocol or "..".`)
      continue
    }
    const file = resolve(entry.dir, board.file)
    if (!(await pathExists(file))) {
      problems.push(`Board "${board.id}": file "${board.file}" does not exist.`)
    } else {
      const artifactsDir = artifactsDirOf(entry.dir)!
      problems.push(...(await fileReferenceProblems(file, artifactsDir, linked)).map(problem => `Board "${board.id}": ${problem}`))
    }
  }
  return problems
}

function isSingleSection(html: string): boolean {
  const trimmed = html.trim()
  if (!/^<section\b/i.test(trimmed) || !/<\/section>$/i.test(trimmed)) return false
  const tags = [...trimmed.matchAll(SECTION_TAG_PATTERN)]
  let depth = 0
  return tags.every((tag, index) => {
    depth += tag[0].startsWith('</') ? -1 : 1
    return depth > 0 || index === tags.length - 1
  })
}

function slideMarkupProblems(html: string): string[] {
  const problems: string[] = []
  if (!isSingleSection(html)) {
    problems.push('the file must hold exactly one <section> element and nothing before or after it.')
  }
  if (SCRIPT_TAG_PATTERN.test(html)) problems.push('a slide cannot contain <script>. Put content that needs a script into an embedded page and show it with <iframe src="embeds/...">.')
  if (EVENT_ATTRIBUTE_PATTERN.test(html)) problems.push('a slide cannot use inline event attributes such as onclick.')
  return problems
}

async function deckProblems(entry: ArtifactEntry, entryFile: string, linked: string[]): Promise<string[]> {
  const artifactsDir = artifactsDirOf(entry.dir)!
  const problems: string[] = []
  if (!isDeckEntryHtml(await readFile(entryFile, 'utf-8'))) {
    problems.push(`The entry file "${entry.manifest?.entry}" of a deck must be exactly the deck entry file from the artifacts skill.`)
  }
  const stylesheet = join(entry.dir, DECK_STYLESHEET_FILE)
  if (await pathExists(stylesheet)) {
    problems.push(...(await fileReferenceProblems(stylesheet, artifactsDir, linked)).map(problem => `${DECK_STYLESHEET_FILE}: ${problem}`))
  } else {
    problems.push(`${DECK_STYLESHEET_FILE} does not exist.`)
  }

  const listed = new Set<string>()
  const embeds = new Set<string>()
  for (const id of entry.manifest?.slides ?? []) {
    if (!isSafeSlideId(id)) {
      problems.push(`Slide id "${id}" may only use letters, digits, "_" and "-", and at most 64 characters.`)
      continue
    }
    if (listed.has(id)) {
      problems.push(`Slide id "${id}" is used twice.`)
      continue
    }
    listed.add(id)
    const file = join(entry.dir, slideFile(id))
    if (!(await pathExists(file))) {
      problems.push(`Slide "${id}": ${slideFile(id)} does not exist.`)
      continue
    }
    const html = await readFile(file, 'utf-8')
    const found = [...slideMarkupProblems(html), ...(await referenceProblems(html, entry.dir, artifactsDir, linked))]
    for (const reference of localReferences((html.match(IFRAME_TAG_PATTERN) ?? []).join(''))) {
      const target = resolve(entry.dir, decodeURIComponent(reference))
      if (isSameOrInsidePathForPlatform(target, entry.dir)) embeds.add(target)
      else if (isSameOrInsidePathForPlatform(target, artifactsDir)) found.push(`the embedded page "${reference}" must be inside this artifact's folder.`)
    }
    problems.push(...found.map(problem => `Slide "${id}": ${problem}`))
  }

  const slideFiles = await readdir(join(entry.dir, DECK_SLIDES_DIR)).catch(() => [])
  for (const name of slideFiles.sort()) {
    if (name.endsWith('.html') && !listed.has(name.slice(0, -'.html'.length))) {
      problems.push(`${DECK_SLIDES_DIR}/${name} is not listed in "slides" of artifact.json, so it is not shown.`)
    }
  }
  for (const embed of embeds) {
    if (!(await pathExists(embed))) continue
    const name = relative(entry.dir, embed).split(sep).join('/')
    problems.push(...(await fileReferenceProblems(embed, artifactsDir, linked)).map(problem => `${name}: ${problem}`))
  }
  return problems
}

async function kindProblems(entry: ArtifactEntry, entryFile: string, artifactsDir: string, linked: string[]): Promise<string[]> {
  if (entry.manifest?.kind === 'canvas') return canvasProblems(entry, entryFile, linked)
  if (entry.manifest?.kind === 'deck') return deckProblems(entry, entryFile, linked)
  return fileReferenceProblems(entryFile, artifactsDir, linked)
}

export async function checkArtifact(inputPath: string): Promise<string[]> {
  const folder = inputPath.endsWith(ARTIFACT_MANIFEST_FILE) ? dirname(inputPath) : inputPath
  const artifactsDir = artifactsDirOf(folder)
  const name = artifactNameOf(folder)
  if (!artifactsDir || !name || resolve(folder) !== join(artifactsDir, name)) {
    return [`${inputPath} is not an artifact folder directly inside a dc_artifacts directory.`]
  }
  const entry = await readArtifactEntry(artifactsDir, name)
  if (!entry) return [`${join(folder, ARTIFACT_MANIFEST_FILE)} does not exist.`]
  if (!entry.manifest) return [entry.error ?? 'artifact.json is invalid.']

  const entryFile = await resolveArtifactEntryFile(entry)
  if (!entryFile) return [`The entry file "${entry.manifest.entry}" does not exist inside the artifact folder.`]
  const linked: string[] = []
  const problems = await kindProblems(entry, entryFile, artifactsDir, linked)
  if (entry.manifest.designSystem) {
    problems.push(...(await designSystemProblems(artifactsDir, entry.manifest.designSystem, entry.manifest.kind, linked)))
  }
  return problems
}
