// Extract tool calls from local session transcripts into the record format.
// The output contains private commands and file contents: it goes to the
// gitignored private/ directory and is never committed or sent to a hosted
// model. Only counts are printed.
//
//   bun experiments/system1-guardrail/dataset/extract-private.ts \
//     [--sessions ~/.dreamcoder/projects] [--out <dir>] [--per-session 40]
//
// Labels are left empty: they come from the labeling step in README.md.
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { basename, join } from 'path'
import {
  assignSplits,
  clipOutput,
  dataFiles,
  dedupKey,
  parseFlags,
  sha256,
  type Step,
  type ToolCallRecord,
  type Trajectory,
  writeJsonl,
} from './lib'
import { writeManifest } from './manifest'

const flags = parseFlags(process.argv.slice(2))
const sessionsRoot = flags.get('sessions') ?? join(homedir(), '.dreamcoder', 'projects')
const out = flags.get('out') ?? join(import.meta.dir, 'private')
const perSession = Number(flags.get('per-session') ?? 40)

/** Tools whose calls go through a permission decision worth measuring. */
const SAMPLED_TOOLS = new Set([
  'Bash',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
])
const isSampled = (tool: string) => SAMPLED_TOOLS.has(tool) || tool.startsWith('mcp__')

type Block = {
  type: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  text?: string
}
type Line = {
  type?: string
  cwd?: string
  isMeta?: boolean
  entrypoint?: string
  version?: string
  message?: { content?: string | Block[] }
  permissionDecision?: { decision?: string; source?: string }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => (block?.type === 'text' ? String(block.text ?? '') : `[${block?.type}]`))
    .join('\n')
}

/** Text the user typed, or null for tool results and injected messages. */
function userText(line: Line): string | null {
  if (line.isMeta) return null
  const content = line.message?.content
  const text =
    typeof content === 'string'
      ? content
      : (content ?? [])
          .filter(block => block.type === 'text')
          .map(block => block.text ?? '')
          .join('\n')
  const trimmed = text.trim()
  return trimmed && !trimmed.startsWith('<') ? trimmed : null
}

/** Deterministic per-session sample of call indices. */
function sample(indices: number[], sessionId: string, n: number): Set<number> {
  return new Set(
    [...indices]
      .sort((a, b) => sha256(`${sessionId}:${a}`).localeCompare(sha256(`${sessionId}:${b}`)))
      .slice(0, n),
  )
}

type Call = {
  step: Step
  cwd: string
  userRequest: string
  hint: { decision?: string; source?: string } | null
  isError: boolean
}

function readSession(path: string): { calls: Call[]; firstRequest: string; projectRoot: string | null; entrypoint: string | null } {
  const calls: Call[] = []
  const pending = new Map<string, number>()
  let request = ''
  let firstRequest = ''
  let projectRoot: string | null = null
  let entrypoint: string | null = null
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    if (!raw) continue
    let line: Line
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    if (line.type !== 'user' && line.type !== 'assistant') continue
    projectRoot ??= line.cwd ?? null
    entrypoint ??= line.entrypoint ?? null
    const blocks = Array.isArray(line.message?.content) ? line.message.content : []
    if (line.type === 'user') {
      const text = userText(line)
      if (text) {
        request = text
        firstRequest ||= text
      }
      for (const block of blocks) {
        if (block.type !== 'tool_result' || !block.tool_use_id) continue
        const index = pending.get(block.tool_use_id)
        if (index === undefined) continue
        const call = calls[index]!
        Object.assign(call.step, clipOutput(resultText(block.content)))
        call.isError = block.is_error === true
        call.hint = line.permissionDecision
          ? { decision: line.permissionDecision.decision, source: line.permissionDecision.source }
          : null
      }
      continue
    }
    for (const block of blocks) {
      if (block.type !== 'tool_use' || !block.id || !block.name) continue
      pending.set(block.id, calls.length)
      calls.push({
        step: { tool: block.name, input: block.input ?? {}, output: '' },
        cwd: line.cwd ?? projectRoot ?? '',
        userRequest: request,
        hint: null,
        isError: false,
      })
    }
  }
  return { calls, firstRequest, projectRoot, entrypoint }
}

// Session files: <project>/<session>.jsonl and <project>/<session>/subagents/*.jsonl.
// Subagent transcripts belong to their parent session for the split.
const files: { path: string; sessionId: string; project: string }[] = []
for (const project of readdirSync(sessionsRoot)) {
  const projectDir = join(sessionsRoot, project)
  for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push({ path: join(projectDir, entry.name), sessionId: entry.name.replace(/\.jsonl$/, ''), project })
    } else if (entry.isDirectory() && existsSync(join(projectDir, entry.name, 'subagents'))) {
      for (const sub of readdirSync(join(projectDir, entry.name, 'subagents'))) {
        if (sub.endsWith('.jsonl')) {
          files.push({ path: join(projectDir, entry.name, 'subagents', sub), sessionId: entry.name, project })
        }
      }
    }
  }
}

const splits = assignSplits(new Map(files.map(f => [f.sessionId, 'private'])))
const records: ToolCallRecord[] = []
const trajectories: Trajectory[] = []
const counts = { transcripts: files.length, sessions: splits.size, tool_calls: 0, sampled_tool_calls: 0 }
for (const file of files) {
  const { calls, firstRequest, projectRoot, entrypoint } = readSession(file.path)
  counts.tool_calls += calls.length
  if (calls.length === 0) continue
  // Subagent transcript names repeat across sessions, so they are named
  // under their parent session.
  const trajectoryId = file.path.includes('/subagents/')
    ? `private/${file.project}/${file.sessionId}/${basename(file.path, '.jsonl')}`
    : `private/${file.project}/${file.sessionId}`
  trajectories.push({ id: trajectoryId, user_request: firstRequest, steps: calls.map(c => c.step) })
  const candidates = calls.flatMap((call, i) => (isSampled(call.step.tool) ? [i] : []))
  const chosen = sample(candidates, trajectoryId, perSession)
  counts.sampled_tool_calls += chosen.size
  for (const i of [...chosen].sort((a, b) => a - b)) {
    const call = calls[i]!
    records.push({
      id: `${trajectoryId}/${i}`,
      source: 'private',
      split: splits.get(file.sessionId)!,
      category: null,
      tool: call.step.tool,
      input: call.step.input,
      cwd: call.cwd,
      project_root: projectRoot ?? call.cwd,
      context: { trajectory_id: trajectoryId, user_request: call.userRequest, prior_steps: i },
      label: null,
      label_source: null,
      rules_decision: null,
      rules_reason: null,
      dedup_key: dedupKey(file.sessionId, call.step.tool, call.step.input),
      meta: {
        session_id: file.sessionId,
        subagent: file.path.includes('/subagents/'),
        entrypoint,
        transcript_hint: call.hint,
        tool_error: call.isError,
      },
    })
  }
}

writeJsonl(dataFiles(out).records, records)
writeJsonl(dataFiles(out).trajectories, trajectories)
writeManifest(out, { source: 'private', per_session: perSession })
console.log(JSON.stringify({ ...counts, records: records.length, out }, null, 2))
