// Writes the inputs for a local decision model run, so the Python adapters in
// ../local-models/ score exactly the text the hosted candidates get: the
// rendered state, the question with the policy, and the two options.
//
//   bun experiments/system1-guardrail/eval/export.ts --model julia-1 --source saber --split dev \
//     --view full [--budget 1500] [--question 0 | --chat] [--limit 200] [--tag v1]
//
// --chat is for local chat models: they get the chat baseline's system prompt
// instead of a decision question, and the adapter reads P(ask).
//
// Writes runs/<name>/meta.json and runs/<name>/inputs.jsonl, then the adapter
// writes runs/<name>/predictions.jsonl. The private set is allowed here: it
// stays on this machine.
import { join } from 'path'
import { parseFlags, sha256, type Split, writeJsonl } from '../dataset/lib'
import { renderState, type View, VIEWS } from './input'
import { datasetHashes, evalRecords, runDir, type Source, writeRunMeta } from './lib'
import { CHAT_SCHEMA, CHAT_SYSTEM, OPTIONS, promptHash, QUESTIONS, questionText } from './policy'

const flags = parseFlags(process.argv.slice(2))
const model = flags.get('model')
if (!model) throw new Error('--model is required (julia-1 or laya)')
const source = (flags.get('source') ?? 'saber') as Source
const split = (flags.get('split') ?? 'dev') as Split
const view = (flags.get('view') ?? 'full') as View
if (!VIEWS.includes(view)) throw new Error(`--view must be one of ${VIEWS.join(', ')}`)
const budget = flags.has('budget') && flags.get('budget') !== 'none' ? Number(flags.get('budget')) : null
const question = Number(flags.get('question') ?? 0)
const q = QUESTIONS[question]
if (!q) throw new Error(`--question must be 0..${QUESTIONS.length - 1}`)
const limit = flags.has('limit') ? Number(flags.get('limit')) : null

const chat = flags.has('chat')
let records = evalRecords(source, split)
if (limit !== null) records = records.sort((a, b) => sha256(a.id).localeCompare(sha256(b.id))).slice(0, limit)
const name = [
  source,
  split,
  model,
  view,
  budget === null ? 'all' : `b${budget}`,
  chat ? 'chat' : `q${question}`,
  ...(limit === null ? [] : [`n${limit}`]),
  ...(flags.has('tag') ? [flags.get('tag')!] : []),
].join('-')

const instructions = chat ? CHAT_SYSTEM : questionText(question)
// The adapters ask a yes/no question; `yes` says whether yes means allow or ask.
const criteria = chat
  ? null
  : q.yes === 'allow'
    ? { true: OPTIONS.allow, false: OPTIONS.ask }
    : { true: OPTIONS.ask, false: OPTIONS.allow }
const yes = chat ? 'ask' : q.yes

writeRunMeta({
  name,
  candidate: model,
  model,
  source,
  split,
  view,
  budget_chars: budget,
  ...(chat ? {} : { phrasing: question }),
  prompt_sha256: chat ? promptHash(CHAT_SYSTEM, CHAT_SCHEMA) : promptHash(instructions, criteria),
  dataset: source === 'saber' ? datasetHashes(source) : {},
  records: records.length,
  created_at: new Date().toISOString(),
})
writeJsonl(
  join(runDir(name), 'inputs.jsonl'),
  records.map(r => ({ id: r.id, state: renderState(r, view, budget), instructions, criteria, yes })),
)
console.log(JSON.stringify({ run: name, records: records.length }))
