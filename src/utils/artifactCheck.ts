import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  ARTIFACT_MANIFEST_FILE,
  artifactNameOf,
  artifactsDirOf,
  resolveArtifactEntryFile,
  readArtifactEntry,
  type ArtifactEntry,
} from './artifacts.js'
import { isSameOrInsidePathForPlatform } from './windowsDrivePath.js'
import { pathExists } from './file.js'
import { isCanvasEntryHtml, isSafeBoardFile } from './canvas.js'
import { DESIGN_SYSTEM_DOC_FILE, DESIGN_SYSTEM_TOKENS_FILE, designSystemsDirOf } from './designSystems.js'

const REFERENCE_PATTERN = /\b(?:src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi
const REMOTE_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

const SCRIPT_BODY_PATTERN = /(<script\b[^>]*>)[\s\S]*?<\/script>/gi

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

async function designSystemProblems(artifactsDir: string, reference: string, linked: string[]): Promise<string[]> {
  const systemDir = resolve(artifactsDir, reference)
  if (!isSameOrInsidePathForPlatform(systemDir, designSystemsDirOf(artifactsDir)) || systemDir === designSystemsDirOf(artifactsDir)) {
    return [`designSystem "${reference}" must point to systems/<name> inside dc_artifacts/.`]
  }
  const problems: string[] = []
  for (const file of [DESIGN_SYSTEM_DOC_FILE, DESIGN_SYSTEM_TOKENS_FILE]) {
    if (!(await pathExists(join(systemDir, file)))) problems.push(`The design system "${reference}" has no ${file}.`)
  }
  const tokens = join(systemDir, DESIGN_SYSTEM_TOKENS_FILE)
  if (!linked.includes(tokens)) {
    problems.push(`The entry page does not link ${reference}/${DESIGN_SYSTEM_TOKENS_FILE}. Add a <link rel="stylesheet"> with a relative path and use var(--*) for colors, fonts and sizes.`)
  }
  return problems
}

async function referenceProblems(htmlFile: string, artifactsDir: string, linked: string[]): Promise<string[]> {
  const problems: string[] = []
  for (const reference of localReferences(await readFile(htmlFile, 'utf-8'))) {
    const target = resolve(dirname(htmlFile), decodeURIComponent(reference))
    linked.push(target)
    if (!isSameOrInsidePathForPlatform(target, artifactsDir)) {
      problems.push(`"${reference}" points outside dc_artifacts/. Copy the file into the artifact folder and reference it from there.`)
    } else if (!(await pathExists(target))) {
      problems.push(`"${reference}" does not exist.`)
    }
  }
  return problems
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
      problems.push(...(await referenceProblems(file, artifactsDir, linked)).map(problem => `Board "${board.id}": ${problem}`))
    }
  }
  return problems
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
  const problems = entry.manifest.kind === 'canvas'
    ? await canvasProblems(entry, entryFile, linked)
    : await referenceProblems(entryFile, artifactsDir, linked)
  if (entry.manifest.designSystem) problems.push(...(await designSystemProblems(artifactsDir, entry.manifest.designSystem, linked)))
  return problems
}
