import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BUNDLED_CATALOG_FILE, fileExists, type BundledLicense } from '../../src/utils/bundledContent.js'
import type {
  DesignTemplateCatalog,
  DesignTemplateCategory,
  DesignTemplateParam,
  DesignTemplateRecord,
} from '../../src/utils/designTemplates.js'
import { clearSubfolders, holderOf, parseLicense, readIfExists, sourceCommit } from '../lib/bundle.js'

const CATEGORIES: readonly string[] = ['web', 'prototype']
const ENTRY_SOURCE_FILE = 'example.html'
const ENTRY_FILE = 'index.html'
const OWN_LICENSE_FILE = 'LICENSE'
const ROOT_LICENSE_COPY = 'LICENSE-open-design.txt'
const DESCRIPTION_CUTOFF = /\s(?:Use when|Trigger keywords|Built by|Respects)\b/
const STYLE_MAX_WORDS_EN = 30
const STYLE_MAX_CHARS_ZH = 60

export const SOURCE_DIRS = ['design-templates', 'skills'] as const
export type SourceDir = (typeof SOURCE_DIRS)[number]
const DEFAULT_SOURCE_DIR: SourceDir = 'design-templates'

export type TemplateCuration = {
  sourceDir?: SourceDir
  category: DesignTemplateCategory
  acceptsDesignSystem: boolean
  title: { en: string; zh: string }
  descriptionZh?: string
  tags: string[]
  prompt: { en: string; zh: string }
  style: { en: string; zh: string }
}

export type Curation = {
  sourceRepo: string
  templates: Record<string, TemplateCuration>
}

type Metadata = Record<string, unknown>

export function parseFrontmatter(text: string): Metadata {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) throw new Error('SKILL.md has no frontmatter')
  const parsed: unknown = Bun.YAML.parse(match[1]!)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('The frontmatter is not a mapping')
  return parsed as Metadata
}

export function summarize(description: string): string {
  const collapsed = description.replace(/\s+/g, ' ').trim()
  const cut = DESCRIPTION_CUTOFF.exec(collapsed)
  return (cut ? collapsed.slice(0, cut.index) : collapsed).trim()
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function sourceDirOf(id: string, curation: TemplateCuration): SourceDir {
  const sourceDir = curation.sourceDir ?? DEFAULT_SOURCE_DIR
  if (!SOURCE_DIRS.includes(sourceDir)) throw new Error(`${id}: unknown source folder ${String(sourceDir)}`)
  return sourceDir
}

export function styleProblems(style: { en: string; zh: string } | undefined): string[] {
  if (!style || typeof style.en !== 'string' || typeof style.zh !== 'string' || style.en.trim() === '' || style.zh.trim() === '') {
    return ['style needs an English and a Chinese sentence']
  }
  const problems: string[] = []
  if (/[\r\n]/.test(style.en) || /[\r\n]/.test(style.zh)) problems.push('style must be one line')
  if (style.en.trim().split(/\s+/).length > STYLE_MAX_WORDS_EN) problems.push(`English style is longer than ${STYLE_MAX_WORDS_EN} words`)
  if ([...style.zh.trim()].length > STYLE_MAX_CHARS_ZH) problems.push(`Chinese style is longer than ${STYLE_MAX_CHARS_ZH} characters`)
  return problems
}

export function parseParams(inputs: unknown): DesignTemplateParam[] {
  if (!Array.isArray(inputs)) return []
  return inputs.flatMap((input): DesignTemplateParam[] => {
    const record = asRecord(input)
    const name = asString(record.name)
    const type = asString(record.type)
    if (!name || !type) return []
    const fallback = record.default
    return [{
      name,
      type,
      required: record.required === true,
      ...(typeof fallback === 'string' || typeof fallback === 'number' || typeof fallback === 'boolean' ? { default: fallback } : {}),
    }]
  })
}

export type BuildRecordInput = {
  id: string
  metadata: Metadata
  curation: TemplateCuration
  license: BundledLicense
  author: string
  repo: string
  commit: string
}

export function buildRecord(input: BuildRecordInput): DesignTemplateRecord {
  const { id, metadata, curation } = input
  if (!CATEGORIES.includes(curation.category)) throw new Error(`${id}: unknown category ${curation.category}`)
  const sourceDir = sourceDirOf(id, curation)
  const style = styleProblems(curation.style)
  if (style.length > 0) throw new Error(`${id}: ${style.join('; ')}`)
  const od = asRecord(metadata.od)
  const descriptionEn = asString(metadata.en_description) ?? asString(metadata.description)
  if (!descriptionEn) throw new Error(`${id}: no description`)
  const descriptionZh = curation.descriptionZh ?? asString(metadata.zh_description)
  if (!descriptionZh) throw new Error(`${id}: no Chinese description`)
  const platform = od.platform === 'mobile' || od.platform === 'desktop' ? od.platform : null
  return {
    id,
    category: curation.category,
    platform,
    scenario: asString(od.scenario),
    entry: ENTRY_FILE,
    acceptsDesignSystem: curation.acceptsDesignSystem,
    params: parseParams(od.inputs),
    prompt: curation.prompt,
    title: curation.title,
    description: { en: summarize(descriptionEn), zh: descriptionZh },
    tags: curation.tags,
    style: curation.style,
    license: input.license,
    author: input.author,
    source: { repo: input.repo, commit: input.commit, path: `${sourceDir}/${id}` },
  }
}

export type ConvertOptions = {
  sourceDir: string
  curation: Curation
  outDir: string
  commit: string
}

export async function convertTemplates(options: ConvertOptions): Promise<DesignTemplateCatalog> {
  const sourceRoot = resolve(options.sourceDir)
  const rootLicenseText = await readIfExists(join(sourceRoot, 'LICENSE'))
  if (!rootLicenseText) throw new Error('The source repository has no root LICENSE')
  const rootLicense = parseLicense(rootLicenseText)

  const records: DesignTemplateRecord[] = []
  const staged: Array<{ id: string; folder: string; ownLicense: string | null }> = []
  for (const [id, curation] of Object.entries(options.curation.templates)) {
    const folder = join(sourceRoot, sourceDirOf(id, curation), id)
    const skill = await readIfExists(join(folder, 'SKILL.md'))
    if (!skill) throw new Error(`${id}: the source folder or its SKILL.md is missing`)
    if (!(await fileExists(join(folder, ENTRY_SOURCE_FILE)))) {
      throw new Error(`${id}: ${ENTRY_SOURCE_FILE} is missing`)
    }
    const ownLicenseText = await readIfExists(join(folder, OWN_LICENSE_FILE))
    const own = ownLicenseText ? parseLicense(ownLicenseText) : null
    const license: BundledLicense = own
      ? { id: own.id, file: OWN_LICENSE_FILE, copyright: own.copyright }
      : { id: rootLicense.id, file: null, copyright: rootLicense.copyright }
    records.push(buildRecord({
      id,
      metadata: parseFrontmatter(skill),
      curation,
      license,
      author: holderOf(license.copyright),
      repo: options.curation.sourceRepo,
      commit: options.commit,
    }))
    staged.push({ id, folder, ownLicense: ownLicenseText })
  }

  const outDir = resolve(options.outDir)
  await clearSubfolders(outDir)
  for (const { id, folder, ownLicense } of staged) {
    const target = join(outDir, id)
    await mkdir(target, { recursive: true })
    await cp(join(folder, ENTRY_SOURCE_FILE), join(target, ENTRY_FILE))
    if (ownLicense) await writeFile(join(target, OWN_LICENSE_FILE), ownLicense, 'utf-8')
  }
  await writeFile(join(outDir, ROOT_LICENSE_COPY), rootLicenseText, 'utf-8')
  const catalog: DesignTemplateCatalog = { version: 1, templates: records }
  await writeFile(join(outDir, BUNDLED_CATALOG_FILE), `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8')
  return catalog
}

async function main() {
  const [sourceDir] = process.argv.slice(2)
  if (!sourceDir) throw new Error('Usage: bun run scripts/design-templates/convert.ts <open-design checkout>')
  const here = import.meta.dir
  const curation = JSON.parse(await readFile(join(here, 'curation.json'), 'utf-8')) as Curation
  const commit = sourceCommit(sourceDir)
  const catalog = await convertTemplates({ sourceDir, curation, outDir: join(here, '..', '..', 'desktop', 'design-templates'), commit })
  console.log(`Converted ${catalog.templates.length} templates at ${commit}`)
}

if (import.meta.main) await main()
