import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isENOENT } from './errors.js'
import { blocksDocument } from '../../vendor/showai/src/agent/page-authoring.js'
import { applyOperations } from '../../vendor/showai/src/core/diff.js'
import { componentSignature } from '../../vendor/showai/src/portable/component-signature.mjs'
import g2Fields from '../../vendor/showai/resources/catalog/g2-fields.json'
import type { PageOperation, ShowDocument } from '../../vendor/showai/src/core/model.js'
import { collectCustomComponentRefs } from '../../vendor/showai/src/components/custom/contract.js'
import {
  compileHtmlBlock,
  CUSTOM_BLOCK_KIND,
  HTML_BLOCK_GUIDE,
  HTML_BLOCK_KIND,
  htmlBlockProblem,
  isHtmlComponentId,
  type HtmlComponent,
} from './uiPageHtml.js'
import type { UiPageSummary } from '../server/session/state/types.js'

const UI_PAGES_DIRNAME = 'ui-pages'
export const UI_PAGE_MAX_BYTES = 512 * 1024
const UI_PAGE_TITLE_MAX_LENGTH = 120
const UI_PAGE_FORMAT = 'showai'
const UI_PAGE_FORMAT_VERSION = 3

export const UI_PAGE_KINDS = [
  'text',
  'table',
  'callout',
  'toggle',
  'divider',
  'code',
  'chart',
  'playground',
  'flowchart',
  'sequence-diagram',
  'mindmap',
  'event-timeline',
  'stepper',
  'metrics',
  'database',
  'references',
  'step-walkthrough',
  'comparison-matrix',
  'status-tree',
  'experiment-tracker',
  'layer-diagram',
  'step-guide',
  'command-reference',
  'structure-browser',
  'card-grid',
  'roadmap',
  'waterfall',
  'scene-3d',
  'pdf',
  'archify',
  'diagram-design',
  'fireworks-tech-graph',
  'html',
] as const
const G2_KIND_PREFIX = 'g2-'

const PAGE_ID_PATTERN = /^[0-9a-f]{24}$/
const REVISION_FILE_PATTERN = /^(\d+)\.json$/
const READ_ONLY_MODE = 0o444

type UiPageErrorCode = 'not_found' | 'conflict' | 'too_large' | 'invalid_page'

export class UiPageError extends Error {
  constructor(readonly code: UiPageErrorCode, message: string) {
    super(message)
    this.name = 'UiPageError'
  }
}

export type { UiPageSummary }

export type UiPageArtifact = {
  format: typeof UI_PAGE_FORMAT
  version: typeof UI_PAGE_FORMAT_VERSION
  document: ShowDocument
  components?: HtmlComponent[]
}

export type UiPageRevision = UiPageSummary & {
  artifact: UiPageArtifact
}

type UiPageBlock = { kind: string; data: Record<string, unknown> }
export type UiPageOperation = PageOperation

function isUiPageId(value: unknown): value is string {
  return typeof value === 'string' && PAGE_ID_PATTERN.test(value)
}

export function isUiPageKind(kind: string): boolean {
  return (UI_PAGE_KINDS as readonly string[]).includes(kind) || kind.startsWith(G2_KIND_PREFIX)
}

export function parseUiPageResult(content: unknown): UiPageSummary | null {
  const text = Array.isArray(content)
    ? content.map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('')
    : content
  if (typeof text !== 'string') return null
  try {
    const value = JSON.parse(text) as Partial<UiPageSummary>
    if (!isUiPageId(value.pageId) || !Number.isInteger(value.revision) || value.revision! < 1) return null
    return { pageId: value.pageId, revision: value.revision!, title: typeof value.title === 'string' ? value.title : value.pageId }
  } catch {
    return null
  }
}

function uiPagesDir(sessionDir: string): string {
  return join(sessionDir, UI_PAGES_DIRNAME)
}

function pageDir(sessionDir: string, pageId: string): string {
  return join(uiPagesDir(sessionDir), pageId)
}

function uiPageRevisionPath(sessionDir: string, pageId: string, revision: number): string {
  return join(pageDir(sessionDir, pageId), `${revision}.json`)
}

function normalizeTitle(title: string): string {
  return title.trim().slice(0, UI_PAGE_TITLE_MAX_LENGTH)
}

type PageNode = { type?: string; attrs?: Record<string, unknown>; content?: PageNode[] }
type UiPageBlockSummary = { id: string; kind: string; component: boolean }

function blockSummary(node: PageNode): UiPageBlockSummary | null {
  const id = node.attrs?.id
  if (typeof id !== 'string') return null
  if (node.type === 'widget' && node.attrs?.kind === CUSTOM_BLOCK_KIND) return { id, kind: HTML_BLOCK_KIND, component: false }
  if (node.type === 'widget' && typeof node.attrs?.kind === 'string') return { id, kind: node.attrs.kind, component: true }
  return { id, kind: node.type === 'richText' ? 'text' : node.type ?? 'block', component: false }
}

export function uiPageBlocks(document: ShowDocument): UiPageBlockSummary[] {
  return ((document.content.content ?? []) as PageNode[]).flatMap((node) => {
    const summary = blockSummary(node)
    return summary ? [summary] : []
  })
}

function findBlock(node: PageNode, id: string): PageNode | null {
  for (const child of node.content ?? []) {
    if (child.attrs?.id === id) return child
    const found = findBlock(child, id)
    if (found) return found
  }
  return null
}

function assertComponentTargets(document: ShowDocument, operations: UiPageOperation[]): void {
  for (const operation of operations) {
    if (operation.type !== 'component.props.set') continue
    const node = findBlock(document.content as PageNode, operation.blockId)
    const summary = node ? blockSummary(node) : null
    if (!summary || summary.component) continue
    throw new UiPageError(
      'invalid_page',
      `Block ${operation.blockId} is a plain ${summary.kind} block, not a component, so component.props.set cannot change it. Remove it with block.remove and insert the new version with component.insert { kind: "${summary.kind}", data, afterId } at the same place. Nothing was saved.`,
    )
  }
}

type G2Fields = Record<string, Record<string, { fields: string[] | null }>>

function widgets(node: PageNode): PageNode[] {
  return (node.content ?? []).flatMap((child) => [...(child.type === 'widget' ? [child] : []), ...widgets(child)])
}

function g2FieldProblems(kind: string, data: Record<string, unknown>): string[] {
  const spec = (g2Fields as G2Fields)[kind]
  if (!spec) return []
  const datasets = (data.datasets ?? {}) as Record<string, unknown>
  const mapping = (data.fields ?? {}) as Record<string, string>
  return Object.entries(spec).flatMap(([key, { fields }]) => {
    const records = datasets[key]
    if (records === undefined) return [`${kind} needs datasets.${key}; keep the dataset keys of the example (${Object.keys(spec).join(', ')}).`]
    if (!fields || !Array.isArray(records)) return []
    const missing = fields.filter((field) => !records.some((record) => record !== null && typeof record === 'object' && Object.hasOwn(record, mapping[field] ?? field)))
    if (missing.length === 0) return []
    const yours = [...new Set(records.flatMap((record) => (record !== null && typeof record === 'object' ? Object.keys(record) : [])))]
    const suggestion = Object.fromEntries(missing.map((field) => [field, '<your field>']))
    return [
      `${kind} reads the fields ${fields.join(', ')} from datasets.${key}, but your records have no ${missing.join(', ')} (they have ${yours.join(', ') || 'no fields'}). Rename your fields to match, or map them with fields: ${JSON.stringify({ ...mapping, ...suggestion })} (example field → your field).`,
    ]
  })
}

function assertG2Fields(document: ShowDocument): void {
  const problems = widgets(document.content as PageNode).flatMap((node) =>
    typeof node.attrs?.kind === 'string' && node.attrs.data && typeof node.attrs.data === 'object'
      ? g2FieldProblems(node.attrs.kind, node.attrs.data as Record<string, unknown>)
      : [],
  )
  if (problems.length > 0) throw new UiPageError('invalid_page', `${problems.join(' ')} Nothing was saved.`)
}

function widgetKinds(document: ShowDocument): string[] {
  return [
    ...new Set(
      widgets(document.content as PageNode).flatMap((node) => (typeof node.attrs?.kind === 'string' ? [node.attrs.kind] : [])),
    ),
  ]
}

function assertSupportedKinds(kinds: string[]): void {
  const unsupported = [...new Set(kinds.filter((kind) => !isUiPageKind(kind)))]
  if (unsupported.length > 0) {
    throw new UiPageError(
      'invalid_page',
      `Unsupported component kind ${unsupported.join(', ')}. Use one of ${UI_PAGE_KINDS.join(', ')} or a g2-* chart.`,
    )
  }
}

function compileHtml<T extends { kind?: unknown; data?: unknown }>(item: T, components: HtmlComponent[]): T {
  if (item.kind !== HTML_BLOCK_KIND) return item
  const data = (item.data ?? {}) as Record<string, unknown>
  const problem = htmlBlockProblem(data)
  if (problem) throw new UiPageError('invalid_page', `${problem} Nothing was saved.`)
  const compiled = compileHtmlBlock(data as { html: string; title?: string })
  components.push(compiled.component)
  return { ...item, kind: CUSTOM_BLOCK_KIND, data: compiled.data }
}

function usedComponents(document: ShowDocument, components: HtmlComponent[]): HtmlComponent[] {
  const used = new Set(collectCustomComponentRefs(document).map((ref) => ref.integrity))
  const byIntegrity = new Map(components.map((component) => [component.integrity, component]))
  return [...byIntegrity.values()].filter((component) => used.has(component.integrity))
}

function checkedArtifact(document: ShowDocument, components: HtmlComponent[]): { artifact: UiPageArtifact; json: string } {
  assertSupportedKinds(widgetKinds(document).filter((kind) => kind !== CUSTOM_BLOCK_KIND))
  const unknownCustom = collectCustomComponentRefs(document).filter((ref) => !isHtmlComponentId(ref.componentId) || !components.some((component) => component.integrity === ref.integrity))
  if (unknownCustom.length > 0) throw new UiPageError('invalid_page', `Unsupported component kind custom. Use an html block instead. Nothing was saved.`)
  assertG2Fields(document)
  const artifact: UiPageArtifact = {
    format: UI_PAGE_FORMAT,
    version: UI_PAGE_FORMAT_VERSION,
    document,
    ...(components.length > 0 ? { components } : {}),
  }
  const json = JSON.stringify(artifact)
  const bytes = Buffer.byteLength(json, 'utf8')
  if (bytes > UI_PAGE_MAX_BYTES) {
    throw new UiPageError('too_large', `The page is ${bytes} bytes; the limit is ${UI_PAGE_MAX_BYTES} bytes. Make the page smaller.`)
  }
  return { artifact, json }
}

function authoring<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof UiPageError) throw error
    throw new UiPageError('invalid_page', `No change was saved. ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function listRevisions(sessionDir: string, pageId: string): Promise<number[]> {
  let names: string[]
  try {
    names = await readdir(pageDir(sessionDir, pageId))
  } catch (error) {
    if (isENOENT(error)) return []
    throw error
  }
  const revisions: number[] = []
  for (const name of names) {
    const match = REVISION_FILE_PATTERN.exec(name)
    if (match) revisions.push(Number(match[1]))
  }
  return revisions.sort((a, b) => a - b)
}

async function writeRevision(
  sessionDir: string,
  pageId: string,
  revision: number,
  document: ShowDocument,
  components: HtmlComponent[],
): Promise<UiPageRevision> {
  const { artifact, json } = checkedArtifact(document, usedComponents(document, components))
  await mkdir(pageDir(sessionDir, pageId), { recursive: true })
  try {
    await writeFile(uiPageRevisionPath(sessionDir, pageId, revision), json, { encoding: 'utf8', flag: 'wx', mode: READ_ONLY_MODE })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw conflictError(pageId, revision - 1, revision)
    throw error
  }
  return { pageId, revision, title: document.title, artifact }
}

function conflictError(pageId: string, baseRevision: number, latest: number): UiPageError {
  return new UiPageError(
    'conflict',
    `Page ${pageId} is at revision ${latest}, not ${baseRevision}. Read the latest revision first with ShowUI({ pageId: "${pageId}" }), then retry with baseRevision ${latest}.`,
  )
}

export async function readUiPageRevision(sessionDir: string, pageId: string, revision: number): Promise<UiPageRevision | null> {
  if (!isUiPageId(pageId) || !Number.isInteger(revision) || revision < 1) return null
  try {
    const artifact = JSON.parse(await readFile(uiPageRevisionPath(sessionDir, pageId, revision), 'utf8')) as UiPageArtifact
    return { pageId, revision, title: artifact.document.title, artifact }
  } catch (error) {
    if (isENOENT(error)) return null
    throw error
  }
}

export async function readLatestUiPage(sessionDir: string, pageId: string): Promise<UiPageRevision> {
  const latest = isUiPageId(pageId) ? (await listRevisions(sessionDir, pageId)).at(-1) : undefined
  const page = latest === undefined ? null : await readUiPageRevision(sessionDir, pageId, latest)
  if (!page) throw new UiPageError('not_found', `Unknown page ${pageId}.`)
  return page
}

export async function createUiPage(sessionDir: string, input: { title: string; blocks: UiPageBlock[] }): Promise<UiPageRevision> {
  assertSupportedKinds(kindsUsed(input))
  const pageId = randomBytes(12).toString('hex')
  const components: HtmlComponent[] = []
  const blocks = input.blocks.map((block) => compileHtml(block, components))
  const document = authoring(() => blocksDocument(blocks, normalizeTitle(input.title) || pageId))
  return writeRevision(sessionDir, pageId, 1, { ...document, id: pageId }, components)
}

export async function changeUiPage(
  sessionDir: string,
  input: { pageId: string; baseRevision: number; operations: UiPageOperation[] },
): Promise<UiPageRevision> {
  const current = await readLatestUiPage(sessionDir, input.pageId)
  if (current.revision !== input.baseRevision) throw conflictError(input.pageId, input.baseRevision, current.revision)
  assertSupportedKinds(kindsUsed(input))
  assertComponentTargets(current.artifact.document, input.operations)
  const components = [...(current.artifact.components ?? [])]
  const operations = input.operations.map((operation) => compileHtml(operation as UiPageOperation & { kind?: unknown; data?: unknown }, components))
  const document = authoring(() => applyOperations(current.artifact.document, operations as UiPageOperation[]))
  return writeRevision(sessionDir, input.pageId, current.revision + 1, document, components)
}

type CatalogEntry = { kind: string; name?: string; description?: string; propsSchema?: unknown; examples?: unknown }
type ComponentGuide = { reuse?: unknown; usage?: unknown }
type Catalog = { entries: CatalogEntry[]; guides: Record<string, ComponentGuide> }

let catalog: Promise<Catalog> | null = null

function supportedCatalog(): Promise<Catalog> {
  catalog ??= Promise.all([
    import('../../vendor/showai/resources/catalog/primitives.json'),
    import('../../vendor/showai/resources/catalog/components.json'),
    import('../../vendor/showai/resources/catalog/g2.json'),
    import('../../vendor/showai/resources/catalog/diagrams.json'),
    import('../../vendor/showai/resources/catalog/component-documentation.json'),
    import('../../vendor/showai/resources/catalog/diagram-documentation.json'),
  ]).then(([primitives, components, g2, diagrams, documentation, diagramDocumentation]) => ({
    entries: [primitives, components, g2, diagrams]
      .flatMap((file) => file.default as CatalogEntry[])
      .filter((entry) => isUiPageKind(entry.kind)),
    guides: { ...documentation.default, ...diagramDocumentation.default } as Record<string, ComponentGuide>,
  }))
  return catalog
}

export async function listUiPageComponents(): Promise<{ kind: string; name?: string; description?: string; signature?: string }[]> {
  return [...(await supportedCatalog()).entries, HTML_BLOCK_GUIDE].map(({ kind, name, description, propsSchema }) => ({
    kind,
    name,
    description,
    ...(propsSchema === undefined ? {} : { signature: componentSignature(kind, propsSchema) }),
  }))
}

export async function describeUiPageKinds(kinds: string[]): Promise<(CatalogEntry & { guide?: ComponentGuide })[]> {
  const { entries, guides } = await supportedCatalog()
  return kinds.map((kind) => {
    if (kind === HTML_BLOCK_KIND) return HTML_BLOCK_GUIDE
    const entry = entries.find((item) => item.kind === kind)
    if (!entry) throw new UiPageError('not_found', `Unknown component kind ${kind}. List the components with ShowUI({ catalog: true }).`)
    const guide = guides[kind]
    return {
      kind,
      name: entry.name,
      description: entry.description,
      ...(guide ? { guide: { reuse: guide.reuse, usage: guide.usage } } : {}),
      propsSchema: entry.propsSchema,
      examples: entry.examples,
    }
  })
}

export function kindsUsed(input: { blocks?: UiPageBlock[]; operations?: UiPageOperation[] }): string[] {
  const kinds = [
    ...(input.blocks ?? []).map((block) => block.kind),
    ...(input.operations ?? []).flatMap((operation) => (operation.type === 'component.insert' ? [operation.kind] : [])),
  ]
  return [...new Set(kinds.filter((kind): kind is string => typeof kind === 'string'))]
}

export async function listUiPages(sessionDir: string): Promise<UiPageSummary[]> {
  let ids: string[]
  try {
    ids = await readdir(uiPagesDir(sessionDir))
  } catch (error) {
    if (isENOENT(error)) return []
    throw error
  }
  const pages: UiPageSummary[] = []
  for (const pageId of ids.filter(isUiPageId)) {
    const latest = (await listRevisions(sessionDir, pageId)).at(-1)
    const page = latest === undefined ? null : await readUiPageRevision(sessionDir, pageId, latest)
    if (page) pages.push({ pageId, revision: page.revision, title: page.title })
  }
  return pages.sort((a, b) => a.pageId.localeCompare(b.pageId))
}
