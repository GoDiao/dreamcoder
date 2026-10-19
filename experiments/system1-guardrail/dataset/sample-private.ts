// Pick private records to label: unlabeled calls the rules would ask about,
// at most `--per-session` per session, mostly from test (where coverage is
// measured) and the rest from dev (where thresholds are tuned). Writes a
// compact view of each call for the labeler to private/label-sample.jsonl.
//
//   bun experiments/system1-guardrail/dataset/sample-private.ts [--test 100] [--dev 50] [--per-session 2]
import { join } from 'path'
import { loadRecords, parseFlags, sha256, type Split, type ToolCallRecord, writeJsonl } from './lib'

const flags = parseFlags(process.argv.slice(2))
const dir = join(import.meta.dir, 'private')
const want: Partial<Record<Split, number>> = {
  test: Number(flags.get('test') ?? 100),
  dev: Number(flags.get('dev') ?? 50),
}
const perSession = Number(flags.get('per-session') ?? 2)

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)} [... ${text.length - max} more chars]` : text

const candidates = loadRecords(dir)
  .filter(r => r.rules_decision === 'ask' && r.label === null)
  .sort((a, b) => sha256(a.id).localeCompare(sha256(b.id)))

const picked: ToolCallRecord[] = []
for (const [split, n] of Object.entries(want) as [Split, number][]) {
  const perSessionCount = new Map<string, number>()
  for (const record of candidates) {
    if (picked.filter(r => r.split === split).length >= n) break
    if (record.split !== split) continue
    const session = String(record.meta.session_id)
    if ((perSessionCount.get(session) ?? 0) >= perSession) continue
    perSessionCount.set(session, (perSessionCount.get(session) ?? 0) + 1)
    picked.push(record)
  }
}

writeJsonl(
  join(dir, 'label-sample.jsonl'),
  picked.map(r => ({
    id: r.id,
    split: r.split,
    tool: r.tool,
    input: clip(JSON.stringify(r.input), 1500),
    cwd: r.cwd,
    project_root: r.project_root,
    rules_reason: r.rules_reason,
    user_request: clip(r.context.user_request, 400),
    recent_steps: (r.context.steps ?? []).slice(-3).map(s => ({
      tool: s.tool,
      input: clip(JSON.stringify(s.input), 300),
      output: clip(s.output, 300),
    })),
  })),
)
const bySplit = Object.fromEntries(Object.keys(want).map(s => [s, picked.filter(r => r.split === s).length]))
console.log(JSON.stringify({ candidates: candidates.length, picked: bySplit }))
