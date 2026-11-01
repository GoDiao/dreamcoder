import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BUNDLED_CATALOG_FILE, type BundledLicense } from '../../src/utils/bundledContent.js'
import {
  DESIGN_SYSTEM_DOC_FILE,
  DESIGN_SYSTEM_TOKENS_FILE,
  type DesignSystemCatalog,
  type DesignSystemRecord,
} from '../../src/utils/designSystems.js'
import { clearSubfolders, holderOf, parseLicense, readIfExists, sourceCommit } from '../lib/bundle.js'

const MANIFEST_SCHEMA = 'od-design-system-project/v1'
const SOURCE_DIRNAME = 'design-systems'
const SCHEMA_FOLDER = '_schema'
const LICENSE_FILE = 'LICENSE'
const ROOT_LICENSE_COPY = 'LICENSE-open-design.txt'
const COPIED_FILES = [DESIGN_SYSTEM_DOC_FILE, DESIGN_SYSTEM_TOKENS_FILE]
const SWATCH_VARIABLES = ['--bg', '--surface', '--fg', '--accent']
const BOILERPLATE_DESCRIPTION = /^Bundled OpenDesign package for\b/
const LITERAL_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\))$/i

export type SystemException = {
  licenseId: string
  licenseText: string
  author: string
}

export type Curation = {
  sourceRepo: string
  bundledOrigin: string
  excluded: Record<string, string>
  exceptions: Record<string, SystemException>
}

export type StarterMetadata = {
  id: string
  name: { en: string; zh: string }
  category: string
  description: { en: string; zh: string }
}

export type StarterSet = {
  sourceRepo: string
  starters: StarterMetadata[]
}

type Manifest = {
  id: string
  name: string
  category: string
  description: string
  origin: string
}

function stringField(record: Record<string, unknown>, field: string, id: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${id}: manifest.${field} is missing`)
  return value.trim()
}

export function parseManifest(folderName: string, raw: string): Manifest {
  const data: unknown = JSON.parse(raw)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error(`${folderName}: manifest.json is not an object`)
  const record = data as Record<string, unknown>
  if (record.schemaVersion !== MANIFEST_SCHEMA) throw new Error(`${folderName}: unexpected manifest schema ${String(record.schemaVersion)}`)
  const id = stringField(record, 'id', folderName)
  if (id !== folderName) throw new Error(`${folderName}: manifest id is ${id}`)
  const source = (typeof record.source === 'object' && record.source !== null ? record.source : {}) as Record<string, unknown>
  return {
    id,
    name: stringField(record, 'name', id),
    category: stringField(record, 'category', id),
    description: stringField(record, 'description', id).replace(/\s+/g, ' '),
    origin: stringField(source, 'origin', id),
  }
}

export function summarizeSystem(description: string, designDoc: string): string {
  if (!BOILERPLATE_DESCRIPTION.test(description)) return description
  const quote = designDoc
    .split('\n', 12)
    .find(line => line.startsWith('> ') && !line.startsWith('> Category:'))
  return quote ? quote.slice(2).replace(/\s+/g, ' ').trim() : description
}

export function readSwatches(id: string, tokens: string): string[] {
  const values = new Map<string, string>()
  for (const match of tokens.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    if (!values.has(match[1]!)) values.set(match[1]!, match[2]!.trim())
  }
  return SWATCH_VARIABLES.map(variable => {
    const value = values.get(variable)
    if (!value || !LITERAL_COLOR.test(value)) throw new Error(`${id}: ${variable} is not a color literal in tokens.css`)
    return value
  })
}

export type ConvertOptions = {
  sourceDir: string
  curation: Curation
  starterSet: StarterSet
  starterDir: string
  licenseDir: string
  outDir: string
  commit: string
}

async function requireFile(path: string, message: string): Promise<string> {
  const text = await readIfExists(path)
  if (text === null) throw new Error(message)
  return text
}

type Staged = { id: string; folder: string; licenseText: string | null }

export async function convertDesignSystems(options: ConvertOptions): Promise<DesignSystemCatalog> {
  const sourceRoot = resolve(options.sourceDir)
  const rootLicenseText = await requireFile(join(sourceRoot, LICENSE_FILE), 'The source repository has no root LICENSE')
  const rootLicense = parseLicense(rootLicenseText)
  const upstreamOf = (id: string) => ({ repo: options.curation.sourceRepo, commit: options.commit, path: `${SOURCE_DIRNAME}/${id}` })

  const converted: DesignSystemRecord[] = []
  const staged: Staged[] = []
  const folders = (await readdir(join(sourceRoot, SOURCE_DIRNAME), { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name !== SCHEMA_FOLDER)
    .map(entry => entry.name)
    .sort()
  for (const folderName of folders) {
    if (options.curation.excluded[folderName] !== undefined) continue
    const folder = join(sourceRoot, SOURCE_DIRNAME, folderName)
    const manifest = parseManifest(folderName, await requireFile(join(folder, 'manifest.json'), `${folderName}: manifest.json is missing`))
    for (const file of COPIED_FILES) await requireFile(join(folder, file), `${folderName}: ${file} is missing`)
    const tokens = await readFile(join(folder, DESIGN_SYSTEM_TOKENS_FILE), 'utf-8')

    let license: BundledLicense
    let author: string
    let licenseText: string | null = null
    if (manifest.origin === options.curation.bundledOrigin) {
      license = { id: rootLicense.id, file: null, copyright: rootLicense.copyright }
      author = holderOf(rootLicense.copyright)
    } else {
      const exception = options.curation.exceptions[folderName]
      if (!exception) throw new Error(`${folderName}: origin "${manifest.origin}" is neither the bundled origin nor listed in the curation`)
      licenseText = await requireFile(join(options.licenseDir, exception.licenseText), `${folderName}: ${exception.licenseText} is missing`)
      const own = parseLicense(licenseText)
      if (own.id !== exception.licenseId) throw new Error(`${folderName}: the license text is ${own.id}, the curation says ${exception.licenseId}`)
      license = { id: own.id, file: LICENSE_FILE, copyright: own.copyright }
      author = exception.author
    }
    converted.push({
      id: manifest.id,
      name: { en: manifest.name, zh: '' },
      category: manifest.category,
      description: { en: summarizeSystem(manifest.description, await readFile(join(folder, DESIGN_SYSTEM_DOC_FILE), 'utf-8')), zh: '' },
      origin: 'converted',
      swatches: readSwatches(manifest.id, tokens),
      license,
      author,
      upstream: upstreamOf(manifest.id),
    })
    staged.push({ id: manifest.id, folder, licenseText })
  }

  const starters: DesignSystemRecord[] = []
  for (const starter of options.starterSet.starters) {
    const folder = join(resolve(options.starterDir), starter.id)
    for (const file of COPIED_FILES) await requireFile(join(folder, file), `${starter.id}: ${file} is missing`)
    if (converted.some(record => record.id === starter.id)) throw new Error(`${starter.id}: the id is also used by a converted system`)
    starters.push({
      id: starter.id,
      name: starter.name,
      category: starter.category,
      description: starter.description,
      origin: 'starter',
      swatches: readSwatches(starter.id, await readFile(join(folder, DESIGN_SYSTEM_TOKENS_FILE), 'utf-8')),
      license: { id: 'MIT', file: null, copyright: 'Copyright (c) 2024-2026 GoDiao & DreamCoder Contributors' },
      author: 'DreamCoder',
      upstream: null,
    })
    staged.push({ id: starter.id, folder, licenseText: null })
  }

  const outDir = resolve(options.outDir)
  await clearSubfolders(outDir)
  for (const { id, folder, licenseText } of staged) {
    const target = join(outDir, id)
    await mkdir(target, { recursive: true })
    for (const file of COPIED_FILES) await cp(join(folder, file), join(target, file))
    if (licenseText) await writeFile(join(target, LICENSE_FILE), licenseText, 'utf-8')
  }
  await writeFile(join(outDir, ROOT_LICENSE_COPY), rootLicenseText, 'utf-8')
  const catalog: DesignSystemCatalog = { version: 1, systems: [...starters, ...converted] }
  await writeFile(join(outDir, BUNDLED_CATALOG_FILE), `${JSON.stringify(catalog)}\n`, 'utf-8')
  return catalog
}

async function main() {
  const [sourceDir] = process.argv.slice(2)
  if (!sourceDir) throw new Error('Usage: bun run scripts/design-systems/convert.ts <open-design checkout>')
  const here = import.meta.dir
  const curation = JSON.parse(await readFile(join(here, 'curation.json'), 'utf-8')) as Curation
  const starterSet = JSON.parse(await readFile(join(here, 'starters.json'), 'utf-8')) as StarterSet
  const commit = sourceCommit(sourceDir)
  const catalog = await convertDesignSystems({
    sourceDir,
    curation,
    starterSet,
    starterDir: join(here, 'starters'),
    licenseDir: here,
    outDir: join(here, '..', '..', 'desktop', 'design-systems'),
    commit,
  })
  console.log(`Converted ${catalog.systems.length} design systems at ${commit}`)
}

if (import.meta.main) await main()
