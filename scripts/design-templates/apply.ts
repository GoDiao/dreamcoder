import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { curationOf, readDrafts, type Draft } from './describe.js'
import { option } from '../lib/bundle.js'
import type { Curation, TemplateCuration } from './convert.js'

const OVERRIDE_FIELDS = ['category', 'acceptsDesignSystem', 'title', 'descriptionZh', 'tags', 'prompt', 'style'] as const

export type Approved = {
  ids: string[]
  overrides?: Record<string, Partial<Pick<TemplateCuration, (typeof OVERRIDE_FIELDS)[number]>>>
}

export type ApplyReport = {
  added: string[]
  styled: string[]
  skipped: Array<{ id: string; reason: string }>
}

export function applyDrafts(curation: Curation, drafts: Draft[], approved: Approved): { curation: Curation; report: ApplyReport } {
  const byId = new Map<string, Draft[]>()
  for (const draft of drafts) byId.set(draft.id, [...(byId.get(draft.id) ?? []), draft])
  const templates: Record<string, TemplateCuration> = { ...curation.templates }
  const report: ApplyReport = { added: [], styled: [], skipped: [] }

  for (const [id, entry] of Object.entries(curation.templates)) {
    if (entry.style) continue
    const draft = byId.get(id)?.[0]
    const style = approved.overrides?.[id]?.style ?? draft?.style
    if (!style) {
      report.skipped.push({ id, reason: 'existing entry has no style and there is no draft for it' })
      continue
    }
    templates[id] = { ...entry, style }
    report.styled.push(id)
  }

  for (const id of approved.ids) {
    if (id in curation.templates) continue
    const matches = byId.get(id) ?? []
    if (matches.length === 0) {
      report.skipped.push({ id, reason: 'no draft' })
      continue
    }
    if (matches.length > 1) {
      report.skipped.push({ id, reason: 'the id has drafts in more than one source folder' })
      continue
    }
    const draft = matches[0]!
    if (draft.fit !== 'page') {
      report.skipped.push({ id, reason: `fit is ${draft.fit}` })
      continue
    }
    const override = approved.overrides?.[id] ?? {}
    templates[id] = { ...curationOf(draft), ...override }
    report.added.push(id)
  }
  return { curation: { ...curation, templates }, report }
}

async function main() {
  const args = process.argv.slice(2)
  const draftsRoot = option(args, '--drafts')
  const approvedFile = option(args, '--approved')
  if (!draftsRoot || !approvedFile) throw new Error('Usage: bun run scripts/design-templates/apply.ts --drafts <describe output dir> --approved <approved.json> [--curation curation.json] [--write]')
  const curationFile = resolve(option(args, '--curation') ?? join(import.meta.dir, 'curation.json'))
  const curation = JSON.parse(await readFile(curationFile, 'utf-8')) as Curation
  const approved = JSON.parse(await readFile(approvedFile, 'utf-8')) as Approved
  const drafts = await readDrafts(join(resolve(draftsRoot), 'drafts'))
  const result = applyDrafts(curation, drafts, approved)
  if (args.includes('--write')) await writeFile(curationFile, `${JSON.stringify(result.curation, null, 2)}\n`, 'utf-8')
  console.log(JSON.stringify(result.report, null, 2))
}

if (import.meta.main) await main()
