import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DESIGN_SYSTEMS_FOLDER, isSafeArtifactName, listSafeFolderNames, parseJsonObject } from './artifacts.js'
import { uniqueName } from './artifactTransfer.js'
import {
  BUNDLED_CATALOG_FILE,
  bundledDirCandidates,
  copyFolderOrClean,
  directoryExists,
  fileExists,
  readBundledCatalog,
  resolveBundledDir,
  type BundledLicense,
  type BundledSource,
  type LocalizedText,
} from './bundledContent.js'

export const DESIGN_SYSTEMS_DIRNAME = 'design-systems'
export const DESIGN_SYSTEM_MANIFEST_FILE = 'system.json'
export const DESIGN_SYSTEM_DOC_FILE = 'DESIGN.md'
export const DESIGN_SYSTEM_TOKENS_FILE = 'tokens.css'

export type DesignSystemRecord = {
  id: string
  name: LocalizedText
  category: string
  description: LocalizedText
  origin: 'starter' | 'converted'
  swatches: string[]
  license: BundledLicense
  author: string
  upstream: BundledSource | null
}

export type DesignSystemCatalog = {
  version: 1
  systems: DesignSystemRecord[]
}

export type DesignSystemManifest = {
  version: 1
  name: string
  source: 'bundled' | 'extracted'
  license: string
  author: string
  libraryId?: string
  upstream?: BundledSource
}

export type DesignSystemEntry = {
  name: string
  dir: string
  manifest: DesignSystemManifest | null
  error: string | null
}

export async function resolveDesignSystemsDir(
  candidates: string[] = bundledDirCandidates(DESIGN_SYSTEMS_DIRNAME),
): Promise<string> {
  return resolveBundledDir(candidates, BUNDLED_CATALOG_FILE, 'design system')
}

export async function readDesignSystemCatalog(systemsDir?: string): Promise<DesignSystemCatalog> {
  return readBundledCatalog<'systems', DesignSystemRecord>(systemsDir ?? await resolveDesignSystemsDir(), 'systems', 'design system')
}

export async function findDesignSystem(id: string, systemsDir?: string): Promise<DesignSystemRecord | null> {
  const catalog = await readDesignSystemCatalog(systemsDir)
  return catalog.systems.find(system => system.id === id) ?? null
}

export function parseDesignSystemManifest(raw: string): { manifest: DesignSystemManifest | null; error: string | null } {
  const { record, error: parseError } = parseJsonObject(raw, DESIGN_SYSTEM_MANIFEST_FILE)
  if (!record) return { manifest: null, error: parseError }
  const problems: string[] = []
  if (record.version !== 1) problems.push('version must be 1')
  if (typeof record.name !== 'string' || record.name.trim() === '') problems.push('name is required')
  if (record.source !== 'bundled' && record.source !== 'extracted') problems.push('source must be bundled or extracted')
  if (typeof record.license !== 'string' || record.license.trim() === '') problems.push('license is required')
  if (typeof record.author !== 'string' || record.author.trim() === '') problems.push('author is required')
  if (problems.length > 0) return { manifest: null, error: problems.join('; ') }
  const upstream = record.upstream as Partial<BundledSource> | undefined
  return {
    manifest: {
      version: 1,
      name: record.name as string,
      source: record.source as DesignSystemManifest['source'],
      license: record.license as string,
      author: record.author as string,
      ...(typeof record.libraryId === 'string' && { libraryId: record.libraryId }),
      ...(upstream && typeof upstream.repo === 'string' && typeof upstream.commit === 'string' && typeof upstream.path === 'string' && {
        upstream: { repo: upstream.repo, commit: upstream.commit, path: upstream.path },
      }),
    },
    error: null,
  }
}

export function designSystemsDirOf(artifactsDir: string): string {
  return join(artifactsDir, DESIGN_SYSTEMS_FOLDER)
}

export async function readDesignSystemEntry(systemsDir: string, name: string): Promise<DesignSystemEntry | null> {
  const dir = join(systemsDir, name)
  const raw = await readFile(join(dir, DESIGN_SYSTEM_MANIFEST_FILE), 'utf-8').catch(() => null)
  if (raw === null) return null
  const { manifest, error } = parseDesignSystemManifest(raw)
  return { name, dir, manifest, error }
}

export async function scanDesignSystems(artifactsDir: string): Promise<DesignSystemEntry[]> {
  const systemsDir = designSystemsDirOf(artifactsDir)
  const entries: DesignSystemEntry[] = []
  for (const name of await listSafeFolderNames(systemsDir)) {
    const entry = await readDesignSystemEntry(systemsDir, name)
    if (entry) entries.push(entry)
  }
  return entries
}

export type InstallDesignSystemOptions = {
  systemId: string
  artifactsDir: string
  name?: string
  systemsDir?: string
}

export type InstalledDesignSystem = {
  name: string
  dir: string
  manifest: DesignSystemManifest
  reused: boolean
}

export function manifestForRecord(record: DesignSystemRecord): DesignSystemManifest {
  return {
    version: 1,
    name: record.name.en,
    source: 'bundled',
    license: record.license.id,
    author: record.author,
    libraryId: record.id,
    ...(record.upstream && { upstream: record.upstream }),
  }
}

export async function installDesignSystem(options: InstallDesignSystemOptions): Promise<InstalledDesignSystem> {
  const libraryDir = options.systemsDir ?? await resolveDesignSystemsDir()
  const record = await findDesignSystem(options.systemId, libraryDir)
  if (!record) throw new Error(`Unknown design system: ${options.systemId}`)
  const source = join(libraryDir, record.id)
  if (!(await directoryExists(source))) throw new Error(`The files of design system ${record.id} were not found.`)
  const wanted = options.name ?? record.id
  if (!isSafeArtifactName(wanted)) throw new Error(`"${wanted}" is not a design system name.`)

  const systemsDir = designSystemsDirOf(resolve(options.artifactsDir))
  const installed = (await scanDesignSystems(resolve(options.artifactsDir))).find(entry => entry.manifest?.libraryId === record.id)
  if (installed?.manifest && options.name === undefined) {
    return { name: installed.name, dir: installed.dir, manifest: installed.manifest, reused: true }
  }

  await mkdir(systemsDir, { recursive: true })
  const name = await uniqueName(systemsDir, wanted)
  const dir = join(systemsDir, name)
  const manifest = manifestForRecord(record)
  await copyFolderOrClean(source, dir, async () => {
    for (const file of [DESIGN_SYSTEM_DOC_FILE, DESIGN_SYSTEM_TOKENS_FILE]) {
      if (!(await fileExists(join(dir, file)))) throw new Error(`${file} of design system ${record.id} is missing.`)
    }
    await writeFile(join(dir, DESIGN_SYSTEM_MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8')
  })
  return { name, dir, manifest, reused: false }
}

export function designSystemReference(name: string): string {
  return `${DESIGN_SYSTEMS_FOLDER}/${name}`
}

export function designSystemUsage(name: string, dir: string): string {
  return [
    `The design system "${name}" is at ${dir}. Read ${DESIGN_SYSTEM_DOC_FILE} there for the tone, type and component rules.`,
    `In the artifact's entry HTML load the tokens with a relative path, for example <link rel="stylesheet" href="../${DESIGN_SYSTEMS_FOLDER}/${name}/${DESIGN_SYSTEM_TOKENS_FILE}"> for an entry directly inside the artifact folder, and take every color, font, size, space, radius and shadow from var(--*) instead of writing values.`,
    `Set "designSystem": "${designSystemReference(name)}" in the artifact's artifact.json.`,
  ].join('\n')
}

const INDEX_DESCRIPTION_LIMIT = 110

function shorten(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= INDEX_DESCRIPTION_LIMIT) return collapsed
  const cut = collapsed.slice(0, INDEX_DESCRIPTION_LIMIT)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}…`
}

export function renderDesignSystemIndex(systems: readonly DesignSystemRecord[]): string {
  const groups = new Map<string, DesignSystemRecord[]>()
  for (const system of [...systems].sort((a, b) => Number(b.origin === 'starter') - Number(a.origin === 'starter'))) {
    const key = system.origin === 'starter' ? 'DreamCoder starters' : system.category
    groups.set(key, [...(groups.get(key) ?? []), system])
  }
  return [...groups]
    .map(([category, members]) => {
      const lines = members.map(system => `- ${system.id} (${system.name.en}): ${shorten(system.description.en)}`)
      return `### ${category}\n${lines.join('\n')}`
    })
    .join('\n\n')
}
