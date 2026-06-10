/**
 * Shared utilities for v2 benchmark scripts
 *
 * - Markdown table writer with append-to-file support
 * - JSON result writer for compare.ts consumption
 * - Statistical helpers (median, p99)
 * - Path normalization for Windows-friendly output
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export type BenchResult = {
  name: string                // benchmark name (e.g. "bundle", "polling")
  timestamp: string           // ISO 8601
  git: { ref: string; sha: string; branch: string }
  metrics: Record<string, number | string>
  notes?: string
}

// ─── Statistics ──────────────────────────────────────────────────────

export function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

export function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!
}

// ─── Formatting ──────────────────────────────────────────────────────

export function fmtBytes(b: number): string {
  if (b <= 0) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

export function fmtMs(ms: number): string {
  if (ms < 0) return 'N/A'
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function diffPct(baseline: number, after: number): string {
  if (baseline <= 0) return 'N/A'
  const pct = ((after - baseline) / baseline) * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

// ─── Results IO ──────────────────────────────────────────────────────

const RESULTS_DIR = path.posix.join('E:/AProject/TianX/Personal/dreamfield', '.benchmark-results')

export async function ensureResultsDir(): Promise<string> {
  await fs.mkdir(RESULTS_DIR, { recursive: true })
  return RESULTS_DIR
}

/**
 * Write benchmark result to a JSON file. compare.ts reads these.
 * Filename: <name>-<label>.json (label: "baseline" or "after")
 */
export async function writeResult(label: 'baseline' | 'after', result: BenchResult): Promise<string> {
  const dir = await ensureResultsDir()
  const file = path.posix.join(dir, `${result.name}-${label}.json`)
  await fs.writeFile(file, JSON.stringify(result, null, 2), 'utf-8')
  return file
}

export async function readResult(label: 'baseline' | 'after', name: string): Promise<BenchResult | null> {
  const dir = await ensureResultsDir()
  const file = path.posix.join(dir, `${name}-${label}.json`)
  try {
    const data = await fs.readFile(file, 'utf-8')
    return JSON.parse(data) as BenchResult
  } catch {
    return null
  }
}

// ─── Markdown writer ─────────────────────────────────────────────────

const RESULTS_DOC = path.posix.join('E:/AProject/TianX/Personal/dreamfield', 'docs/perf-optimization-results-v2.md')

export async function appendMarkdownSection(title: string, body: string): Promise<void> {
  const header = `\n\n## ${title}\n\n_Generated: ${new Date().toISOString()}_\n\n`
  let existing = ''
  try {
    existing = await fs.readFile(RESULTS_DOC, 'utf-8')
  } catch {
    existing = `# DreamCoder Performance Optimization Results v2\n\n` +
               `> 配合 \`docs/perf-optimization-plan-v2.md\` 实施过程中产出，由 \`scripts/benchmark/*.ts\` 自动追加。\n`
  }
  await fs.writeFile(RESULTS_DOC, existing + header + body.trim() + '\n', 'utf-8')
}

// ─── Git helpers ─────────────────────────────────────────────────────

import * as childProcess from 'node:child_process'
import { promisify } from 'node:util'
const execFile = promisify(childProcess.execFile)

export async function gitInfo(): Promise<{ ref: string; sha: string; branch: string }> {
  try {
    const { stdout: sha } = await execFile('git', ['rev-parse', 'HEAD'])
    const { stdout: branch } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    return { ref: sha.trim().slice(0, 7), sha: sha.trim(), branch: branch.trim() }
  } catch {
    return { ref: 'unknown', sha: 'unknown', branch: 'unknown' }
  }
}

// ─── Process runner ──────────────────────────────────────────────────

/** Run a command, return stdout. Throws on nonzero exit. */
export async function run(cmd: string, args: string[], opts: { cwd?: string; timeout?: number; env?: Record<string, string> } = {}): Promise<string> {
  const { stdout } = await execFile(cmd, args, {
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    timeout: opts.timeout ?? 120_000,
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, ...(opts.env ?? {}) },
  })
  return stdout
}
