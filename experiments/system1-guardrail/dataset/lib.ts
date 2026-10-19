// Record format, split assignment and gzipped JSONL I/O shared by the
// dataset scripts. See README.md for the format.
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export type Label = 'allow' | 'ask'
export type Decision = 'allow' | 'ask' | 'deny'
export type Split = 'train' | 'dev' | 'test'
export type LabelSource = 'saber-judge' | 'model-agree' | 'human'

export type Step = {
  tool: string
  input: Record<string, unknown>
  output: string
  /** Original output length when `output` was cut to keep files small. */
  output_chars?: number
}

/** One SABER run or one private session: the steps records point into. */
export type Trajectory = {
  id: string
  user_request: string
  steps: Step[]
}

export type ToolCallRecord = {
  id: string
  source: 'saber' | 'private'
  split: Split
  category: string | null
  tool: string
  input: Record<string, unknown>
  cwd: string
  project_root: string
  /**
   * The user's request and the steps before this call. `prior_steps` counts
   * steps of `trajectory_id`; loadRecords() fills in `steps`.
   */
  context: {
    trajectory_id: string
    user_request: string
    prior_steps: number
    steps?: Step[]
  }
  label: Label | null
  label_source: LabelSource | null
  rules_decision: Decision | null
  rules_reason: string | null
  /** Same task (or session) and same call: duplicates across SABER models share it. */
  dedup_key: string
  meta: Record<string, unknown>
}

export const OUTPUT_HEAD = 6000
export const OUTPUT_TAIL = 2000

/** Keep the head and tail of a long tool output. */
export function clipOutput(output: string): Pick<Step, 'output' | 'output_chars'> {
  if (output.length <= OUTPUT_HEAD + OUTPUT_TAIL) return { output }
  return {
    output: `${output.slice(0, OUTPUT_HEAD)}\n[... ${output.length - OUTPUT_HEAD - OUTPUT_TAIL} chars cut ...]\n${output.slice(-OUTPUT_TAIL)}`,
    output_chars: output.length,
  }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function dedupKey(group: string, tool: string, input: unknown): string {
  return sha256(JSON.stringify([group, tool, input])).slice(0, 16)
}

/**
 * Split groups (SABER tasks, private sessions) 70/15/15 within each stratum,
 * ordered by a salted hash so the assignment is stable and not by name.
 */
export function assignSplits(
  groups: Map<string, string>,
): Map<string, Split> {
  const byStratum = new Map<string, string[]>()
  for (const [group, stratum] of groups) {
    const list = byStratum.get(stratum) ?? []
    list.push(group)
    byStratum.set(stratum, list)
  }
  const splits = new Map<string, Split>()
  for (const list of byStratum.values()) {
    list.sort((a, b) =>
      sha256(`system1-phase0a:${a}`).localeCompare(sha256(`system1-phase0a:${b}`)),
    )
    const nTest = Math.round(list.length * 0.15)
    const nDev = Math.round(list.length * 0.15)
    list.forEach((group, i) =>
      splits.set(group, i < nTest ? 'test' : i < nTest + nDev ? 'dev' : 'train'),
    )
  }
  return splits
}

export function readJsonl<T>(path: string): T[] {
  const raw = readFileSync(path)
  const text = path.endsWith('.gz')
    ? new TextDecoder().decode(Bun.gunzipSync(raw))
    : raw.toString('utf8')
  return text
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as T)
}

export function writeJsonl(path: string, rows: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true })
  const text = rows.map(row => JSON.stringify(row)).join('\n') + '\n'
  writeFileSync(
    path,
    path.endsWith('.gz') ? Bun.gzipSync(text, { level: 9 }) : text,
  )
}

/** Data directory layout: `<dir>/records.jsonl.gz` and `<dir>/trajectories.jsonl.gz`. */
export function dataFiles(dir: string) {
  return {
    records: `${dir}/records.jsonl.gz`,
    trajectories: `${dir}/trajectories.jsonl.gz`,
  }
}

/** Load records, with `context.steps` filled in unless `withContext` is false. */
export function loadRecords(
  dir: string,
  { withContext = true } = {},
): ToolCallRecord[] {
  const files = dataFiles(dir)
  const records = readJsonl<ToolCallRecord>(files.records)
  if (!withContext || !existsSync(files.trajectories)) return records
  const trajectories = new Map(
    readJsonl<Trajectory>(files.trajectories).map(t => [t.id, t]),
  )
  for (const record of records) {
    const trajectory = trajectories.get(record.context.trajectory_id)
    record.context.steps =
      trajectory?.steps.slice(0, record.context.prior_steps) ?? []
  }
  return records
}

/** Parse `--name value` flags. */
export function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) flags.set(arg.slice(2), 'true')
    else flags.set(arg.slice(2), argv[++i]!)
  }
  return flags
}
