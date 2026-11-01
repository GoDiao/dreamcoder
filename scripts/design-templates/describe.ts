import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { renderDesignTemplateIndex } from '../../src/utils/designTemplates.js'
import { option } from '../lib/bundle.js'
import { findCandidates, type Candidate } from './candidates.js'
import { buildRecord, parseFrontmatter, styleProblems, SOURCE_DIRS, type Curation, type SourceDir, type TemplateCuration } from './convert.js'

export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash-1017'
export const API_BASE = 'https://openrouter.ai/api/v1'
const HTML_LIMIT = 40000
const STYLE_BLOCK_LIMIT = 8000
const INLINE_STYLE_LIMIT = 300
const SKILL_BODY_LIMIT = 3000
const ATTEMPTS = 3
const BACKOFF_MS = 1000
const FITS = ['page', 'slides', 'video', 'audio', 'image', 'not-a-template'] as const
const CATEGORY_VALUES = ['web', 'prototype'] as const
const INSTRUCTIONS_FILE = join(import.meta.dir, 'describe-instructions.md')

export type Fit = (typeof FITS)[number]

export type ModelDraft = {
  fit: Fit
  fitReason: string
  category: (typeof CATEGORY_VALUES)[number]
  acceptsDesignSystem: boolean
  acceptsReason: string
  title: { en: string; zh: string }
  descriptionZh: string
  tags: string[]
  prompt: { en: string; zh: string }
  style: { en: string; zh: string }
}

export type Usage = { promptTokens: number; completionTokens: number }

export type Draft = ModelDraft & {
  id: string
  sourceDir: SourceDir
  model: string
  relativeReferences: string[]
  indexChars: number | null
  usage: Usage
}

export type Failure = { id: string; sourceDir: SourceDir; error: string }

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export function redact(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[redacted]') : text
}

export function sanitizeHtml(html: string, limit = HTML_LIMIT): string {
  const cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/(<path\b[^>]*?\sd=)(?:"[^"]*"|'[^']*')/gi, '$1""')
    .replace(/data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:base64')
    .replace(/(\sstyle=)"([^"]{300,})"/gi, (_match, attribute: string, value: string) => `${attribute}"${value.slice(0, INLINE_STYLE_LIMIT)}"`)
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, css: string) => `<style>${css.slice(0, STYLE_BLOCK_LIMIT)}</style>`)
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}\n<!-- truncated -->` : cleaned
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function pair(value: unknown, name: string, problems: string[]): { en: string; zh: string } {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const en = text(record.en)
  const zh = text(record.zh)
  if (!en || !zh) problems.push(`${name} needs non-empty en and zh`)
  return { en: en ?? '', zh: zh ?? '' }
}

export function validateModelDraft(value: unknown): { draft: ModelDraft } | { problems: string[] } {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  if (!record) return { problems: ['the answer is not a JSON object'] }
  const problems: string[] = []
  if (!FITS.includes(record.fit as Fit)) problems.push(`fit must be one of ${FITS.join(', ')}`)
  const fitReason = text(record.fitReason)
  if (!fitReason) problems.push('fitReason is required')
  if (!CATEGORY_VALUES.includes(record.category as (typeof CATEGORY_VALUES)[number])) problems.push('category must be web or prototype')
  if (typeof record.acceptsDesignSystem !== 'boolean') problems.push('acceptsDesignSystem must be a boolean')
  const acceptsReason = text(record.acceptsReason)
  if (!acceptsReason) problems.push('acceptsReason is required')
  const title = pair(record.title, 'title', problems)
  const descriptionZh = text(record.descriptionZh)
  if (!descriptionZh) problems.push('descriptionZh is required')
  const tags = Array.isArray(record.tags) ? record.tags : []
  if (tags.length < 3 || tags.length > 5 || !tags.every(tag => typeof tag === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(tag))) {
    problems.push('tags must be 3 to 5 lowercase English words')
  }
  const prompt = pair(record.prompt, 'prompt', problems)
  const style = pair(record.style, 'style', problems)
  if (style.en && style.zh) problems.push(...styleProblems(style))
  if (problems.length > 0) return { problems }
  return {
    draft: {
      fit: record.fit as Fit,
      fitReason: fitReason!,
      category: record.category as ModelDraft['category'],
      acceptsDesignSystem: record.acceptsDesignSystem as boolean,
      acceptsReason: acceptsReason!,
      title,
      descriptionZh: descriptionZh!,
      tags: tags as string[],
      prompt,
      style,
    },
  }
}

export function curationOf(draft: ModelDraft & { sourceDir: SourceDir }): TemplateCuration {
  return {
    ...(draft.sourceDir === 'design-templates' ? {} : { sourceDir: draft.sourceDir }),
    category: draft.category,
    acceptsDesignSystem: draft.acceptsDesignSystem,
    title: draft.title,
    descriptionZh: draft.descriptionZh,
    tags: draft.tags,
    prompt: draft.prompt,
    style: draft.style,
  }
}

type Material = { skill: string; metadataText: string; html: string }

async function readMaterial(checkout: string, candidate: Candidate): Promise<Material> {
  const folder = join(resolve(checkout), candidate.sourceDir, candidate.id)
  const skill = await readFile(join(folder, 'SKILL.md'), 'utf-8')
  const html = await readFile(join(folder, 'example.html'), 'utf-8')
  const body = skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const frontmatter = skill.slice(0, skill.length - body.length)
  return { skill: `${frontmatter}${body.slice(0, SKILL_BODY_LIMIT)}`, metadataText: skill, html: sanitizeHtml(html) }
}

export function buildMessages(instructions: string, examples: Curation, candidate: Candidate, material: Material): ChatMessage[] {
  const shown = Object.entries(examples.templates).map(([id, entry]) => ({ id, ...entry }))
  return [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: [
        'Approved entries, as examples of tone and format:',
        JSON.stringify(shown, null, 2),
        `Template to describe: ${candidate.id} (folder ${candidate.sourceDir}, mode ${candidate.mode}, platform ${candidate.platform ?? 'unknown'}, scenario ${candidate.scenario ?? 'unknown'}, ${candidate.bytes} bytes${candidate.relativeReferences.length > 0 ? `, references other files: ${candidate.relativeReferences.join(', ')}` : ''}).`,
        'SKILL.md:',
        material.skill,
        'example.html (cleaned):',
        material.html,
      ].join('\n\n'),
    },
  ]
}

export type ModelDeps = {
  fetch: FetchLike
  apiKey: string
  model: string
  sleep: (ms: number) => Promise<void>
  baseUrl?: string
}

async function chat(deps: ModelDeps, messages: ChatMessage[]): Promise<{ content: string; usage: Usage }> {
  let response: Response
  try {
    response = await deps.fetch(`${deps.baseUrl ?? API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.apiKey}` },
      body: JSON.stringify({ model: deps.model, messages, response_format: { type: 'json_object' }, temperature: 0.3 }),
    })
  } catch (error) {
    throw new Error(redact(`request failed: ${error instanceof Error ? error.message : String(error)}`, deps.apiKey))
  }
  const body = await response.text()
  if (!response.ok) throw new Error(redact(`HTTP ${response.status}: ${body.slice(0, 300)}`, deps.apiKey))
  let parsed: { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('the response is not JSON')
  }
  const content = parsed.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('the response has no message content')
  return { content, usage: { promptTokens: parsed.usage?.prompt_tokens ?? 0, completionTokens: parsed.usage?.completion_tokens ?? 0 } }
}

export async function describeTemplate(
  deps: ModelDeps,
  instructions: string,
  examples: Curation,
  candidate: Candidate,
  material: Material,
): Promise<{ draft: ModelDraft; usage: Usage } | { error: string; usage: Usage }> {
  const messages = buildMessages(instructions, examples, candidate, material)
  const usage: Usage = { promptTokens: 0, completionTokens: 0 }
  let lastError = ''
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await deps.sleep(BACKOFF_MS * 2 ** (attempt - 1))
    try {
      const answer = await chat(deps, messages)
      usage.promptTokens += answer.usage.promptTokens
      usage.completionTokens += answer.usage.completionTokens
      let value: unknown
      try {
        value = JSON.parse(answer.content)
      } catch {
        lastError = 'the answer is not valid JSON'
        messages.push({ role: 'assistant', content: answer.content }, { role: 'user', content: 'That was not valid JSON. Answer again with one JSON object.' })
        continue
      }
      const checked = validateModelDraft(value)
      if ('draft' in checked) return { draft: checked.draft, usage }
      lastError = checked.problems.join('; ')
      messages.push({ role: 'assistant', content: answer.content }, { role: 'user', content: `The answer has problems: ${lastError}. Answer again with one corrected JSON object.` })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  return { error: lastError, usage }
}

function indexChars(candidate: Candidate, draft: ModelDraft, metadataText: string): number | null {
  try {
    const record = buildRecord({
      id: candidate.id,
      metadata: parseFrontmatter(metadataText),
      curation: curationOf({ ...draft, sourceDir: candidate.sourceDir }),
      license: { id: 'Apache-2.0', file: null, copyright: 'Copyright' },
      author: '',
      repo: '',
      commit: '',
    })
    return renderDesignTemplateIndex([record]).length + 1
  } catch {
    return null
  }
}

const draftName = (sourceDir: string, id: string) => `${sourceDir}--${id}.json`

export async function readDrafts(draftsDir: string): Promise<Draft[]> {
  const names = (await readdir(draftsDir).catch(() => [])).filter(name => name.endsWith('.json')).sort()
  const drafts: Draft[] = []
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(draftsDir, name), 'utf-8')) as Draft
    if (SOURCE_DIRS.includes(parsed.sourceDir) && 'draft' in validateModelDraft(parsed)) drafts.push(parsed)
  }
  return drafts
}

async function pooled<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
      while (next < items.length) await work(items[next++]!)
    }),
  )
}

export type Pricing = { prompt: number; completion: number } | null

export async function fetchPricing(fetchFn: FetchLike, model: string, baseUrl = API_BASE): Promise<Pricing> {
  try {
    const response = await fetchFn(`${baseUrl}/models`)
    if (!response.ok) return null
    const body = (await response.json()) as { data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }> }
    const entry = body.data?.find(item => item.id === model)
    const prompt = Number(entry?.pricing?.prompt)
    const completion = Number(entry?.pricing?.completion)
    return Number.isFinite(prompt) && Number.isFinite(completion) ? { prompt, completion } : null
  } catch {
    return null
  }
}

export function totalUsage(drafts: Draft[], failures: Usage[] = []): Usage {
  return [...drafts.map(draft => draft.usage), ...failures].reduce(
    (sum, usage) => ({ promptTokens: sum.promptTokens + usage.promptTokens, completionTokens: sum.completionTokens + usage.completionTokens }),
    { promptTokens: 0, completionTokens: 0 },
  )
}

export function renderReview(drafts: Draft[], failures: Failure[], cost: number | null): string {
  const attention = (draft: Draft) => draft.fit !== 'page' || draft.relativeReferences.length > 0
  const section = (draft: Draft) => [
    `### ${draft.id} (${draft.sourceDir})`,
    '',
    `- fit: ${draft.fit}. ${draft.fitReason}`,
    `- category: ${draft.category}`,
    `- title: ${draft.title.en} / ${draft.title.zh}`,
    `- description: ${draft.descriptionZh}`,
    `- tags: ${draft.tags.join(', ')}`,
    `- style (en): ${draft.style.en}`,
    `- style (zh): ${draft.style.zh}`,
    `- acceptsDesignSystem: ${draft.acceptsDesignSystem}. ${draft.acceptsReason}`,
    ...(draft.relativeReferences.length > 0 ? [`- references other files: ${draft.relativeReferences.join(', ')}`] : []),
    `- prompt (en): ${draft.prompt.en}`,
    `- prompt (zh): ${draft.prompt.zh}`,
    '',
  ]
  const flagged = drafts.filter(attention)
  const rest = drafts.filter(draft => !attention(draft))
  const pages = drafts.filter(draft => draft.fit === 'page')
  const usage = totalUsage(drafts)
  const indexTotal = pages.reduce((sum, draft) => sum + (draft.indexChars ?? 0), 0)
  return [
    '# Template drafts',
    '',
    `${drafts.length} drafts, ${pages.length} with fit page. Tokens: ${usage.promptTokens} in, ${usage.completionTokens} out${cost === null ? '' : `, estimated cost ${cost.toFixed(4)} USD`}.`,
    `Template index size if every page draft is accepted: about ${indexTotal} characters.`,
    '',
    ...(failures.length > 0 ? ['## Failed', '', ...failures.map(failure => `- ${failure.id} (${failure.sourceDir}): ${failure.error}`), ''] : []),
    '## Needs attention (fit is not page, or references other files)',
    '',
    ...(flagged.length > 0 ? flagged.flatMap(section) : ['None.', '']),
    '## Page drafts',
    '',
    ...rest.flatMap(section),
  ].join('\n')
}

export type DescribeOptions = {
  checkout: string
  candidates: Candidate[]
  outDir: string
  curation: Curation
  deps: ModelDeps
  concurrency: number
  log: (message: string) => void
}

export type DescribeResult = { drafts: Draft[]; failures: Failure[]; usage: Usage; cost: number | null }

export async function runDescribe(options: DescribeOptions): Promise<DescribeResult> {
  const { checkout, candidates, outDir, curation, deps, log } = options
  const draftsDir = join(outDir, 'drafts')
  await mkdir(draftsDir, { recursive: true })
  const instructions = await readFile(INSTRUCTIONS_FILE, 'utf-8')
  const existing = new Set((await readDrafts(draftsDir)).map(draft => draftName(draft.sourceDir, draft.id)))
  const failures: Failure[] = []
  const failedUsage: Usage[] = []
  const todo = candidates.filter(candidate => !existing.has(draftName(candidate.sourceDir, candidate.id)))
  log(`${candidates.length - todo.length} drafts already exist, ${todo.length} to generate with ${deps.model}`)
  await pooled(todo, options.concurrency, async candidate => {
    const material = await readMaterial(checkout, candidate)
    const result = await describeTemplate(deps, instructions, curation, candidate, material)
    if ('error' in result) {
      failures.push({ id: candidate.id, sourceDir: candidate.sourceDir, error: result.error })
      failedUsage.push(result.usage)
      log(`failed: ${candidate.id}`)
      return
    }
    const draft: Draft = {
      ...result.draft,
      id: candidate.id,
      sourceDir: candidate.sourceDir,
      model: deps.model,
      relativeReferences: candidate.relativeReferences,
      indexChars: indexChars(candidate, result.draft, material.metadataText),
      usage: result.usage,
    }
    await writeFile(join(draftsDir, draftName(candidate.sourceDir, candidate.id)), `${JSON.stringify(draft, null, 2)}\n`, 'utf-8')
    log(`done: ${candidate.id}`)
  })
  const drafts = await readDrafts(draftsDir)
  const usage = totalUsage(drafts, failedUsage)
  const pricing = await fetchPricing(deps.fetch, deps.model, deps.baseUrl)
  const cost = pricing ? usage.promptTokens * pricing.prompt + usage.completionTokens * pricing.completion : null
  await writeFile(join(outDir, 'failures.json'), `${JSON.stringify(failures, null, 2)}\n`, 'utf-8')
  await writeFile(join(outDir, 'usage.json'), `${JSON.stringify({ model: deps.model, ...usage, estimatedCostUsd: cost, perTemplate: drafts.map(draft => ({ id: draft.id, ...draft.usage })) }, null, 2)}\n`, 'utf-8')
  await writeFile(join(outDir, 'review.md'), renderReview(drafts, failures, cost), 'utf-8')
  return { drafts, failures, usage, cost }
}

async function main() {
  const args = process.argv.slice(2)
  const checkout = option(args, '--checkout')
  if (!checkout) throw new Error('Usage: bun run scripts/design-templates/describe.ts --checkout <open-design checkout> [--candidates file.json] [--out dir] [--model id] [--concurrency 4] [--only id,id]')
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')
  const candidatesFile = option(args, '--candidates')
  let candidates = candidatesFile ? (JSON.parse(await readFile(candidatesFile, 'utf-8')) as Candidate[]) : await findCandidates(checkout)
  const only = option(args, '--only')?.split(',')
  if (only) candidates = candidates.filter(candidate => only.includes(candidate.id))
  const curation = JSON.parse(await readFile(join(import.meta.dir, 'curation.json'), 'utf-8')) as Curation
  const result = await runDescribe({
    checkout,
    candidates,
    outDir: resolve(option(args, '--out') ?? join(tmpdir(), 'design-template-drafts')),
    curation,
    deps: {
      fetch: (url, init) => fetch(url, init),
      apiKey,
      model: option(args, '--model') ?? process.env.DESIGN_TEMPLATE_MODEL ?? DEFAULT_MODEL,
      sleep: ms => new Promise(done => setTimeout(done, ms)),
    },
    concurrency: Number(option(args, '--concurrency') ?? 4),
    log: message => console.log(message),
  })
  console.log(`${result.drafts.length} drafts, ${result.failures.length} failed, ${result.usage.promptTokens} tokens in, ${result.usage.completionTokens} out${result.cost === null ? '' : `, estimated ${result.cost.toFixed(4)} USD`}`)
}

if (import.meta.main) await main()
