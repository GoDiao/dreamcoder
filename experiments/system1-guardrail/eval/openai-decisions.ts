import { existsSync } from 'fs'
import { join } from 'path'
import { parseFlags, sha256, type Split } from '../dataset/lib'
import { renderState, type View, VIEWS } from './input'
import {
  datasetHashes,
  evalRecords,
  type EvalCohort,
  type Prediction,
  runDir,
  writePredictions,
  writeRunMeta,
} from './lib'
import { promptHash, QUESTIONS, questionText } from './policy'

const flags = parseFlags(process.argv.slice(2))
const model = flags.get('model') ?? 'gpt-6-luna'
const split = (flags.get('split') ?? 'dev') as Split
const view = (flags.get('view') ?? 'full') as View
const cohort = (flags.get('cohort') ?? 'ask') as EvalCohort
const budget = flags.has('budget') && flags.get('budget') !== 'none'
  ? Number(flags.get('budget'))
  : 1500
const question = Number(flags.get('question') ?? 1)
const limit = flags.has('limit') ? Number(flags.get('limit')) : null

if (!VIEWS.includes(view)) throw new Error(`--view must be one of ${VIEWS.join(', ')}`)
if (!['ask', 'allow', 'all'].includes(cohort)) throw new Error('--cohort must be ask, allow or all')
const selectedQuestion = QUESTIONS[question]
if (!selectedQuestion) throw new Error(`--question must be 0..${QUESTIONS.length - 1}`)

let records = evalRecords('saber', split, { cohort })
if (limit !== null) {
  records = records
    .sort((left, right) => sha256(left.id).localeCompare(sha256(right.id)))
    .slice(0, limit)
}

const name = [
  'saber',
  split,
  'openai',
  model,
  cohort,
  view,
  `b${budget}`,
  `q${question}`,
  ...(limit === null ? [] : [`n${limit}`]),
  ...(flags.has('tag') ? [flags.get('tag')!] : []),
].join('-')

if (existsSync(join(runDir(name), 'predictions.jsonl')) && !flags.has('force')) {
  console.log(JSON.stringify({ run: name, skipped: 'already done; pass --force to run it again' }))
  process.exit(0)
}

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
const instructions = questionText(question)

writeRunMeta({
  name,
  candidate: 'openai-decisions',
  model,
  source: 'saber',
  split,
  cohort,
  view,
  budget_chars: budget,
  phrasing: question,
  prompt_sha256: promptHash(instructions),
  dataset: datasetHashes('saber'),
  records: records.length,
  created_at: new Date().toISOString(),
})

async function decide(input: string): Promise<number> {
  const response = await fetch('https://api.openai.com/v1/decisions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input,
      questions: [{ type: 'predicate', name: 'decision', instructions }],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = JSON.parse(text) as { answers?: Array<{ name?: string; probability?: number }> }
  const probability = payload.answers?.find((answer) => answer.name === 'decision')?.probability
  if (typeof probability !== 'number' || probability < 0 || probability > 1) {
    throw new Error('Invalid predicate probability')
  }
  return selectedQuestion.yes === 'ask' ? probability : 1 - probability
}

const predictions: Prediction[] = new Array(records.length)
let next = 0
const workers = Array.from({ length: Number(flags.get('concurrency') ?? 8) }, async () => {
  while (next < records.length) {
    const index = next++
    const record = records[index]!
    const startedAt = performance.now()
    try {
      predictions[index] = {
        id: record.id,
        p_ask: await decide(renderState(record, view, budget)),
        decision: null,
        latency_ms: Math.round(performance.now() - startedAt),
      }
    } catch (error) {
      predictions[index] = {
        id: record.id,
        p_ask: null,
        decision: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
})

await Promise.all(workers)
writePredictions(name, predictions)
console.log(JSON.stringify({
  run: name,
  records: predictions.length,
  failed: predictions.filter((prediction) => prediction.p_ask === null).length,
}))
