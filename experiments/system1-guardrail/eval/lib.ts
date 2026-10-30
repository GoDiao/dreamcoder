// Shared pieces of the evaluation: which records are scored, the run
// directory layout, and the cost ledger for hosted models.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { type Label, loadRecords, readJsonl, type Split, type ToolCallRecord, writeJsonl } from '../dataset/lib'

export const DATASET_DIR = join(import.meta.dir, '..', 'dataset')
export const RUNS_DIR = join(import.meta.dir, 'runs')
export const LEDGER = join(RUNS_DIR, 'ledger.jsonl')

export type Source = 'saber' | 'private'

export function dataDir(source: Source): string {
  return source === 'saber' ? join(DATASET_DIR, 'data', 'saber') : join(DATASET_DIR, 'private')
}

/**
 * The records a guardrail is scored on: labeled calls the current rules
 * would ask about. Everything else the rules already decide.
 */
export function evalRecords(source: Source, split: Split, { withContext = true } = {}): ToolCallRecord[] {
  return loadRecords(dataDir(source), { withContext }).filter(
    r => r.split === split && r.rules_decision === 'ask' && r.label !== null,
  )
}

/** The dataset hashes a run was made on, so results name the exact set. */
export function datasetHashes(source: Source): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(dataDir(source), 'manifest.json'), 'utf8'))
  return { test_set: manifest.sha256.test_set, test_rules: manifest.sha256.test_rules }
}

/** One candidate's answer for one record. `p_ask` is null when it failed. */
export type Prediction = {
  id: string
  p_ask: number | null
  /** The candidate's own yes/no, for candidates that give one (chat models). */
  decision: Label | null
  latency_ms?: number
  error?: string
}

export type RunMeta = {
  name: string
  candidate: string
  model: string
  source: Source
  split: Split
  view: string
  budget_chars: number | null
  phrasing?: number
  prompt_sha256: string
  dataset: Record<string, string>
  records: number
  created_at: string
  [key: string]: unknown
}

export const runDir = (name: string) => join(RUNS_DIR, name)

export function writeRunMeta(meta: RunMeta): void {
  mkdirSync(runDir(meta.name), { recursive: true })
  writeFileSync(join(runDir(meta.name), 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
}

export function readRunMeta(name: string): RunMeta {
  return JSON.parse(readFileSync(join(runDir(name), 'meta.json'), 'utf8'))
}

export function writePredictions(name: string, predictions: Prediction[]): void {
  writeJsonl(join(runDir(name), 'predictions.jsonl'), predictions)
}

export function readPredictions(name: string): Prediction[] {
  return readJsonl<Prediction>(join(runDir(name), 'predictions.jsonl'))
}

/** Money spent on hosted models, in USD, as reported by the provider. */
export function spent(): number {
  if (!existsSync(LEDGER)) return 0
  return readJsonl<{ cost: number }>(LEDGER).reduce((sum, row) => sum + row.cost, 0)
}

export function recordCost(entry: { run: string; ref: string; cost: number }): void {
  mkdirSync(RUNS_DIR, { recursive: true })
  appendFileSync(LEDGER, JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n')
}

/** Estimated cost of submitted batches whose cost is not in the ledger yet. */
export function pending(): number {
  if (!existsSync(RUNS_DIR)) return 0
  return readdirSync(RUNS_DIR).reduce((sum, name) => {
    const path = join(runDir(name), 'batches.json')
    if (!existsSync(path)) return sum
    const batches = JSON.parse(readFileSync(path, 'utf8')) as { requests: number; cost_recorded: boolean }[]
    const meta = readRunMeta(name)
    // The estimate covers the whole run; only the submitted, unbilled part is pending.
    const open = batches.filter(b => !b.cost_recorded).reduce((n, b) => n + b.requests, 0)
    return sum + (Number(meta.est_cost_usd ?? 0) * open) / meta.records
  }, 0)
}
