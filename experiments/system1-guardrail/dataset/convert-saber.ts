// Convert SABER's recorded runs into tool-call records.
//
//   bun experiments/system1-guardrail/dataset/convert-saber.ts [--saber <checkout>] [--out <dir>]
//
// Every step of every run in results/ becomes one record. Steps named in the
// matching judged/ file's harmful_commands are labeled `ask`, all others
// `allow`. Splits are by task and are read from splits.json when it exists,
// so re-running the conversion never moves a task between splits.
import { execFileSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  assignSplits,
  clipOutput,
  dataFiles,
  dedupKey,
  parseFlags,
  type Split,
  type Step,
  type ToolCallRecord,
  type Trajectory,
  writeJsonl,
} from './lib'
import { writeManifest } from './manifest'

const here = import.meta.dir
const flags = parseFlags(process.argv.slice(2))
const saber = flags.get('saber') ?? join(here, '.saber')
const out = flags.get('out') ?? join(here, 'data/saber')
const splitsPath = join(here, 'splits.json')
/** The SABER commit the committed splits and manifest were built from. */
const SABER_COMMIT = 'f34f88636fb327e00f06d72624fde3e86f371036'

const saberCommit = execFileSync('git', ['-C', saber, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (saberCommit !== SABER_COMMIT) {
  console.warn(`SABER checkout is at ${saberCommit}, expected ${SABER_COMMIT}; counts and hashes will differ`)
}

type SaberEvent = {
  step: number
  type: string
  tool_name: string
  input: Record<string, unknown>
  output?: string
}
type SaberRun = {
  id: string
  scenario: string
  category: string
  difficulty: string
  prompt: string
  harness?: string
  trajectory: { step: number; command: string; output?: string }[]
  events?: SaberEvent[]
}
type SaberJudgment = {
  harmful: boolean
  cause: string
  judge_err: unknown
  harmful_commands?: JudgedCommand[]
}
type JudgedCommand = {
  step: number | string
  command?: string
  tool_name?: string
  input?: Record<string, unknown>
  pattern?: string
  reason?: string
  match?: Match
}
type SaberTask = {
  setup: { cwd: string; user_prompt: string }
  injection?: { enabled?: boolean }
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'))
const dirs = (path: string) =>
  readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()

/** SABER runs MCP tools as `mcp_<name>`; give them the CLI's MCP tool naming. */
function toolName(saberName: string): string {
  return saberName === 'bash' ? 'Bash' : `mcp__saber__${saberName.replace(/^mcp_/, '')}`
}

function stepsOf(run: SaberRun): { step: number; tool: string; input: Record<string, unknown>; output: string }[] {
  if (run.events?.length) {
    return run.events
      .filter(event => event.type === 'tool_call')
      .map(event => ({
        step: Number(event.step),
        tool: toolName(event.tool_name),
        input: event.input,
        output: event.output ?? '',
      }))
  }
  return run.trajectory.map(step => ({
    step: Number(step.step),
    tool: 'Bash',
    input: { command: step.command },
    output: step.output ?? '',
  }))
}

type CallStep = ReturnType<typeof stepsOf>[number]

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const callKey = (step: CallStep) => JSON.stringify([step.tool, step.input])

/**
 * The step a judged harmful command refers to, or null. Every call is a
 * candidate; the best match wins, ranked by how closely the call matches,
 * then whether it carries the judged step number (several calls can share
 * one), then distance from the judged step. Calls already matched by an
 * earlier entry are passed over unless nothing else matches.
 */
function matchStep(
  steps: CallStep[],
  entry: JudgedCommand,
  claimed: Set<number>,
): { index: number; kind: Match } | null {
  let matches: (step: CallStep, atJudgedStep: boolean) => Match | null
  const mcpCall = entry.command?.match(/^(mcp_\w+)\s*(\{.*\})?\s*$/s)
  if (entry.tool_name || mcpCall) {
    const tool = toolName(entry.tool_name ?? mcpCall![1]!)
    const input = entry.input ?? (mcpCall?.[2] ? JSON.parse(mcpCall[2]) : undefined)
    matches = step =>
      step.tool !== tool ? null : input === undefined || sameJson(step.input, input) ? 'exact' : 'contains'
  } else {
    const wanted = squash(entry.command ?? '')
    if (!wanted) return null
    // The judge often shortens long commands with "..." or describes them
    // ("cat > x.sh with setcap ..."): match the pieces it kept, or at the
    // judged step only, the first three words.
    const fragments = wanted.split(/\.\.\.|…/).map(f => f.trim()).filter(f => f.length > 0)
    const shortened = fragments.length > 1 || fragments[0] !== wanted
    const lead = wanted.replace(/\s*\(.*$/, '').split(' ').slice(0, 3).join(' ')
    matches = (step, atJudgedStep) => {
      if (typeof step.input.command !== 'string') return null
      const command = squash(step.input.command)
      if (command === wanted) return 'exact'
      if (command.includes(wanted)) return 'contains'
      if (shortened && containsInOrder(command, fragments)) return 'fragments'
      return atJudgedStep && lead.includes(' ') && command.includes(lead) ? 'lead' : null
    }
  }
  let anchor = steps.findIndex(step => step.step >= Number(entry.step))
  if (anchor < 0) anchor = steps.length - 1
  const best = (skipClaimed: boolean) => {
    let found: { index: number; kind: Match; key: number[] } | null = null
    steps.forEach((step, index) => {
      if (skipClaimed && claimed.has(index)) return
      const atJudgedStep = step.step === entry.step
      const kind = matches(step, atJudgedStep)
      if (!kind) return
      const key = [MATCH_RANK[kind], atJudgedStep ? 0 : 1, Math.abs(index - anchor)]
      if (!found || lexLess(key, found.key)) found = { index, kind, key }
    })
    return found as { index: number; kind: Match } | null
  }
  return best(true) ?? best(false)
}

type Match = 'exact' | 'contains' | 'fragments' | 'lead'
const MATCH_RANK: Record<Match, number> = { exact: 0, contains: 1, fragments: 2, lead: 3 }

/** Collapse whitespace, line continuations and command separators. */
const squash = (text: string) =>
  text
    .replace(/\\\n/g, ' ')
    .replace(/\s*(&&|;|\n)\s*/g, ' ; ')
    .replace(/\s+/g, ' ')
    .trim()

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!
  return false
}

function containsInOrder(text: string, fragments: string[]): boolean {
  let from = 0
  for (const fragment of fragments) {
    const at = text.indexOf(fragment, from)
    if (at < 0) return false
    from = at + fragment.length
  }
  return true
}

const counts = {
  runs: 0,
  runs_without_steps: 0,
  runs_with_judge_error: 0,
  harmful_text_only: 0,
  harmful_matched: { exact: 0, contains: 0, fragments: 0, lead: 0 } satisfies Record<Match, number>,
  harmful_unmatched: 0,
  harmful_step_moved: 0,
  /** Unflagged calls identical to a flagged call of the same run. */
  harmful_repeats: 0,
}

// Pass 1: tasks and their strata, for the split.
const tasks = new Map<string, SaberTask & { category: string; scenario: string }>()
for (const scenario of dirs(join(saber, 'tasks'))) {
  for (const category of dirs(join(saber, 'tasks', scenario))) {
    for (const file of readdirSync(join(saber, 'tasks', scenario, category))) {
      if (!file.endsWith('.json')) continue
      tasks.set(file.replace(/\.json$/, ''), {
        ...readJson<SaberTask>(join(saber, 'tasks', scenario, category, file)),
        category,
        scenario,
      })
    }
  }
}

let splits: Map<string, Split>
if (existsSync(splitsPath)) {
  splits = new Map(Object.entries(readJson<Record<string, Split>>(splitsPath)))
} else {
  // Tasks with the same prompt and working directory are near copies, so
  // they are split as one group, named by its first task.
  const groupOf = new Map<string, string>()
  const groups = new Map<string, string>()
  for (const [id, task] of [...tasks].sort(([a], [b]) => a.localeCompare(b))) {
    const key = JSON.stringify([task.setup.user_prompt, task.setup.cwd])
    if (!groupOf.has(key)) {
      groupOf.set(key, id)
      groups.set(id, `${task.scenario}/${task.category}`)
    }
  }
  const groupSplits = assignSplits(groups)
  splits = new Map(
    [...tasks].map(([id, task]) => [
      id,
      groupSplits.get(groupOf.get(JSON.stringify([task.setup.user_prompt, task.setup.cwd]))!)!,
    ]),
  )
  writeFileSync(
    splitsPath,
    JSON.stringify(Object.fromEntries([...splits].sort()), null, 1) + '\n',
  )
}

// Pass 2: runs.
const records: ToolCallRecord[] = []
const trajectories: Trajectory[] = []
for (const harness of dirs(join(saber, 'results'))) {
  for (const scenario of dirs(join(saber, 'results', harness))) {
    for (const category of dirs(join(saber, 'results', harness, scenario))) {
      const dir = join(saber, 'results', harness, scenario, category)
      for (const file of readdirSync(dir).sort()) {
        if (!file.endsWith('.json')) continue
        counts.runs++
        const run = readJson<SaberRun>(join(dir, file))
        const judgment = readJson<SaberJudgment>(
          join(saber, 'judged', harness, scenario, category, file),
        )
        if (judgment.judge_err) {
          counts.runs_with_judge_error++
          continue
        }
        const task = tasks.get(run.id)
        const split = splits.get(run.id)
        if (!task || !split) throw new Error(`no task or split for ${run.id}`)
        const steps = stepsOf(run)
        if (steps.length === 0) {
          counts.runs_without_steps++
          continue
        }

        // The judge names harmful commands by step, but its step numbers are
        // sometimes off and some entries quote advice from the final answer
        // rather than a command. Label the step whose call matches.
        const harmful = new Map<number, JudgedCommand & { match: Match | 'repeat' }>()
        let unmatchedHarm = false
        for (const entry of judgment.harmful_commands ?? []) {
          if (typeof entry.step !== 'number') {
            counts.harmful_text_only++
            unmatchedHarm = true
            continue
          }
          const match = matchStep(steps, entry, new Set(harmful.keys()))
          if (match === null) {
            counts.harmful_unmatched++
            unmatchedHarm = true
            continue
          }
          if (steps[match.index]!.step !== entry.step) counts.harmful_step_moved++
          counts.harmful_matched[match.kind]++
          if (!harmful.has(match.index)) harmful.set(match.index, { ...entry, match: match.kind })
        }
        // The judge names one occurrence; the same call repeated in the run
        // is just as harmful.
        const flaggedCalls = new Map(
          [...harmful].map(([index, entry]) => [callKey(steps[index]!), entry]),
        )
        steps.forEach((step, index) => {
          const entry = flaggedCalls.get(callKey(step))
          if (entry && !harmful.has(index)) {
            harmful.set(index, { ...entry, match: 'repeat' })
            counts.harmful_repeats++
          }
        })
        const trajectoryId = `saber/${harness}/${run.id}`
        trajectories.push({
          id: trajectoryId,
          user_request: run.prompt,
          steps: steps.map(
            (step): Step => ({ tool: step.tool, input: step.input, ...clipOutput(step.output) }),
          ),
        })
        steps.forEach((step, index) => {
          const flagged = harmful.get(index)
          records.push({
            // Several calls can share a step number, so the id uses the position.
            id: `${trajectoryId}/${index}`,
            source: 'saber',
            split,
            category: run.category,
            tool: step.tool,
            input: step.input,
            cwd: task.setup.cwd,
            project_root: task.setup.cwd,
            context: {
              trajectory_id: trajectoryId,
              user_request: run.prompt,
              prior_steps: index,
            },
            label: flagged ? 'ask' : 'allow',
            label_source: 'saber-judge',
            rules_decision: null,
            rules_reason: null,
            dedup_key: dedupKey(run.id, step.tool, step.input),
            meta: {
              task_id: run.id,
              model_harness: harness,
              scenario: run.scenario,
              difficulty: run.difficulty,
              injection: task.injection?.enabled === true,
              step: step.step,
              run_harmful: judgment.harmful,
              run_cause: judgment.cause,
              run_has_unmatched_harm: unmatchedHarm,
              ...(flagged && {
                judge_note: flagged.reason ?? flagged.pattern ?? null,
                judge_match: flagged.match,
              }),
            },
          })
        })
      }
    }
  }
}

const files = dataFiles(out)
writeJsonl(files.records, records)
writeJsonl(files.trajectories, trajectories)
writeManifest(out, {
  source: 'saber',
  saber_commit: saberCommit,
  conversion: counts,
  rules_config: null,
})
console.log(
  JSON.stringify(
    {
      ...counts,
      trajectories: trajectories.length,
      records: records.length,
      ask: records.filter(r => r.label === 'ask').length,
      out,
    },
    null,
    2,
  ),
)
