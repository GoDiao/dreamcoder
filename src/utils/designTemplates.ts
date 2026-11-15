import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  ARTIFACT_MANIFEST_FILE,
  isSafeArtifactName,
  newArtifactId,
  parseArtifactManifest,
  type ArtifactManifest,
} from './artifacts.js'
import { DECK_STYLESHEET_FILE, DECK_SLIDES_DIR } from './deck.js'
import { uniqueName } from './artifactTransfer.js'
import { designSystemReference, installDesignSystem, type InstalledDesignSystem } from './designSystems.js'
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

export const DESIGN_TEMPLATES_DIRNAME = 'design-templates'

export type DesignTemplateCategory = 'web' | 'prototype' | 'slides'

export type DesignTemplateParam = {
  name: string
  type: string
  required: boolean
  default?: string | number | boolean
}

export type DesignTemplateRecord = {
  id: string
  category: DesignTemplateCategory
  platform: 'desktop' | 'mobile' | null
  scenario: string | null
  entry: string
  acceptsDesignSystem: boolean
  params: DesignTemplateParam[]
  prompt: LocalizedText
  title: LocalizedText
  description: LocalizedText
  tags: string[]
  style: LocalizedText
  license: BundledLicense
  author: string
  source: BundledSource
}

export type DesignTemplateCatalog = {
  version: 1
  templates: DesignTemplateRecord[]
}

export async function resolveDesignTemplatesDir(
  candidates: string[] = bundledDirCandidates(DESIGN_TEMPLATES_DIRNAME),
): Promise<string> {
  return resolveBundledDir(candidates, BUNDLED_CATALOG_FILE, 'design template')
}

export async function readDesignTemplateCatalog(templatesDir?: string): Promise<DesignTemplateCatalog> {
  return readBundledCatalog<'templates', DesignTemplateRecord>(templatesDir ?? await resolveDesignTemplatesDir(), 'templates', 'design template')
}

export async function findDesignTemplate(id: string, templatesDir?: string): Promise<DesignTemplateRecord | null> {
  const catalog = await readDesignTemplateCatalog(templatesDir)
  return catalog.templates.find(template => template.id === id) ?? null
}

export function designTemplateFolder(templatesDir: string, template: DesignTemplateRecord): string {
  return join(templatesDir, template.id)
}

async function deckSlidesOf(source: string, template: DesignTemplateRecord): Promise<string[]> {
  const raw = await readFile(join(source, ARTIFACT_MANIFEST_FILE), 'utf-8').catch(() => null)
  const parsed = raw === null ? null : parseArtifactManifest(raw).manifest
  if (parsed?.kind !== 'deck' || !parsed.slides || parsed.entry !== template.entry) {
    throw new Error(`The manifest of slide template ${template.id} is missing or is not a deck.`)
  }
  return parsed.slides
}

export type CreateFromTemplateOptions = {
  templateId: string
  artifactsDir: string
  name?: string
  title?: string
  templatesDir?: string
  designSystemId?: string
  systemsDir?: string
}

export async function createArtifactFromTemplate(
  options: CreateFromTemplateOptions,
): Promise<{ name: string; dir: string; manifest: ArtifactManifest; designSystem: InstalledDesignSystem | null }> {
  const templatesDir = options.templatesDir ?? await resolveDesignTemplatesDir()
  const template = await findDesignTemplate(options.templateId, templatesDir)
  if (!template) throw new Error(`Unknown design template: ${options.templateId}`)
  const source = designTemplateFolder(templatesDir, template)
  if (!(await directoryExists(source))) {
    throw new Error(`The files of design template ${template.id} were not found.`)
  }
  const wanted = options.name ?? template.id
  if (!isSafeArtifactName(wanted)) throw new Error(`"${wanted}" is not an artifact name.`)

  const slides = template.category === 'slides' ? await deckSlidesOf(source, template) : null
  if (options.designSystemId && !template.acceptsDesignSystem) {
    throw new Error(`Design template ${template.id} has its own look and does not take a design system.`)
  }
  const artifactsDir = resolve(options.artifactsDir)
  await mkdir(artifactsDir, { recursive: true })
  const designSystem = options.designSystemId
    ? await installDesignSystem({ systemId: options.designSystemId, artifactsDir, systemsDir: options.systemsDir })
    : null
  const name = await uniqueName(artifactsDir, wanted)
  const dir = join(artifactsDir, name)
  const manifest: ArtifactManifest = {
    version: 1,
    id: newArtifactId(),
    kind: slides ? 'deck' : 'page',
    title: options.title?.trim() || template.title.en,
    entry: template.entry,
    ...(slides && { slides }),
    ...(designSystem && { designSystem: designSystemReference(designSystem.name) }),
    template: { id: template.id, commit: template.source.commit },
  }
  try {
    await copyFolderOrClean(source, dir, async () => {
      if (!(await fileExists(join(dir, template.entry)))) throw new Error(`The entry file of design template ${template.id} is missing.`)
      await writeFile(join(dir, ARTIFACT_MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8')
    })
  } catch (error) {
    if (designSystem && !designSystem.reused) await rm(designSystem.dir, { recursive: true, force: true })
    throw error
  }
  return { name, dir, manifest, designSystem }
}

function adaptTarget(template: DesignTemplateRecord): string {
  if (template.category === 'slides') {
    return `its ${template.entry} is the fixed stage file and stays as it is; the example to adapt is ${DECK_STYLESHEET_FILE}, the slides listed in artifact.json and their files in ${DECK_SLIDES_DIR}/, and DESIGN.md in the folder describes the look. The section numbers and the number of sections in the example are sample content: number them again for the sections of the new deck`
  }
  return `its entry file ${template.entry} is the example to adapt`
}

export function designTemplateGuidance(template: DesignTemplateRecord): string {
  return [
    `The artifact was created from the design template "${template.title.en}" (${template.id}); ${adaptTarget(template)}.`,
    `How to adapt it (English): ${template.prompt.en}`,
    `How to adapt it (中文): ${template.prompt.zh}`,
    template.acceptsDesignSystem ? null : 'This template has its own look and does not take another design system.',
  ].filter((line): line is string => line !== null).join('\n')
}

export function renderDesignTemplateIndex(templates: readonly DesignTemplateRecord[]): string {
  return templates
    .map(template => {
      const facts = [template.category, template.platform, template.scenario].filter(Boolean).join(', ')
      const params = template.params.map(param => (param.required ? `${param.name}*` : param.name)).join(', ')
      const style = template.style.en ? ` Style: ${template.style.en}` : ''
      return [
        `- ${template.id} (${facts}): ${template.title.en}. ${template.description.en}${style}`,
        `  Tags: ${template.tags.join(', ') || 'none'}. ${template.acceptsDesignSystem ? 'Takes a design system.' : 'Fixed look, no design system.'}${params ? ` Inputs: ${params}.` : ''}`,
      ].join('\n')
    })
    .join('\n')
}
