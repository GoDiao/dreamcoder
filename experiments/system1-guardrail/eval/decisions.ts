// Decision models through OpenRouter's Decisions endpoint. Each gets the same
// rendered state as every other candidate and the shared question with the
// policy, as one yes/no question (`noul`) whose probability is the score.
//
//   bun experiments/system1-guardrail/eval/decisions.ts [--model typesafe/jev-1.14] --split dev --view full [--budget 1500] \
//     [--question 0] [--limit 2000] [--concurrency 64] [--tag v1] [--cap 8]
//
// The key is read from OPENROUTER_API_KEY and never printed. Only the public
// SABER set may be sent; the private set never leaves the machine.
import { existsSync } from 'fs'
import { join } from 'path'
import { parseFlags, sha256, type Split } from '../dataset/lib'
import { renderState, type View, VIEWS } from './input'
import { datasetHashes, evalRecords, pending, type Prediction, recordCost, runDir, spent, writePredictions, writeRunMeta } from './lib'
import { OPTIONS, promptHash, QUESTIONS, questionText } from './policy'

const flags = parseFlags(process.argv.slice(2))
// Any model on OpenRouter's Decisions endpoint: Jev, d1-ultra, Mercury Decide,
// Clef, Kev, Solar Decide.
const MODEL = flags.get('model') ?? 'typesafe/jev-1.14'
const API = 'https://openrouter.ai/api/alpha/decisions'
/**
 * Measured on a dev record with Jev: about 1.75 characters per input token at
 * $0.042 per million, the highest price among these models.
 */
const COST_PER_CHAR = 0.042e-6 / 1.75

const split = (flags.get('split') ?? 'dev') as Split
const view = (flags.get('view') ?? 'full') as View
if (!VIEWS.includes(view)) throw new Error(`--view must be one of ${VIEWS.join(', ')}`)
const budget = flags.has('budget') && flags.get('budget') !== 'none' ? Number(flags.get('budget')) : null
const question = Number(flags.get('question') ?? 0)
const q = QUESTIONS[question]
if (!q) throw new Error(`--question must be 0..${QUESTIONS.length - 1}`)
const limit = flags.has('limit') ? Number(flags.get('limit')) : null

let records = evalRecords('saber', split)
if (limit !== null) records = records.sort((a, b) => sha256(a.id).localeCompare(sha256(b.id))).slice(0, limit)
const name = [
  'saber',
  split,
  MODEL.split('/').pop()!,
  view,
  budget === null ? 'all' : `b${budget}`,
  `q${question}`,
  ...(limit === null ? [] : [`n${limit}`]),
  ...(flags.has('tag') ? [flags.get('tag')!] : []),
].join('-')

if (existsSync(join(runDir(name), 'predictions.jsonl')) && !flags.has('force')) {
  console.log(JSON.stringify({ run: name, skipped: 'already done; pass --force to run it again' }))
  process.exit(0)
}

const instructions = questionText(question)
const criteria = q.yes === 'allow' ? { true: OPTIONS.allow, false: OPTIONS.ask } : { true: OPTIONS.ask, false: OPTIONS.allow }

const estimate = records.reduce((n, r) => n + instructions.length + renderState(r, view, budget).length, 0) * COST_PER_CHAR
const cap = Number(flags.get('cap') ?? 8)
if (flags.has('estimate')) {
  console.log(JSON.stringify({ run: name, records: records.length, est_cost_usd: Number(estimate.toFixed(3)) }))
  process.exit(0)
}
const committed = spent() + pending()
if (committed + estimate > cap) {
  throw new Error(`would exceed the $${cap} cap: spent or pending $${committed.toFixed(3)}, this run about $${estimate.toFixed(3)}`)
}
const key = process.env.OPENROUTER_API_KEY
if (!key) throw new Error('OPENROUTER_API_KEY is not set')

writeRunMeta({
  name,
  candidate: MODEL === 'typesafe/jev-1.14' ? 'jev' : MODEL,
  model: MODEL,
  source: 'saber',
  split,
  view,
  budget_chars: budget,
  phrasing: question,
  prompt_sha256: promptHash(instructions, criteria),
  dataset: datasetHashes('saber'),
  records: records.length,
  created_at: new Date().toISOString(),
  est_cost_usd: Number(estimate.toFixed(3)),
})

async function decide(state: string): Promise<{ noul: number; cost: number }> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        state: { situation: state },
        questions: { decision: { type: 'noul', instructions, criteria } },
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await response.body?.cancel()
      await Bun.sleep(2000 * 2 ** attempt)
      continue
    }
    const text = await response.text()
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 300)}`)
    const body = JSON.parse(text)
    const noul = body.answers?.decision?.noul
    if (typeof noul !== 'number' || noul < 0 || noul > 1) throw new Error(`bad answer ${text.slice(0, 200)}`)
    return { noul, cost: Number(body.usage?.cost ?? 0) }
  }
}

const predictions: Prediction[] = new Array(records.length)
let cost = 0
let next = 0
let finished = 0
// A 401/402/403 (key, credit or spending limit) fails every later request
// too: stop instead of writing a run full of failures.
let blocked: string | null = null
const worker = async () => {
  while (next < records.length && blocked === null) {
    const i = next++
    const record = records[i]!
    const started = performance.now()
    try {
      const answer = await decide(renderState(record, view, budget))
      cost += answer.cost
      predictions[i] = {
        id: record.id,
        p_ask: q.yes === 'ask' ? answer.noul : 1 - answer.noul,
        decision: null,
        latency_ms: Math.round(performance.now() - started),
      }
    } catch (error) {
      if (/: 40[123] /.test(String(error))) blocked = String(error).slice(0, 300)
      predictions[i] = { id: record.id, p_ask: null, decision: null, error: String(error).slice(0, 300) }
    }
    if (++finished % 1000 === 0) console.error(`${name}: ${finished}/${records.length}`)
  }
}
await Promise.all(Array.from({ length: Number(flags.get('concurrency') ?? 64) }, worker))
if (blocked !== null) {
  recordCost({ run: name, ref: 'sync-aborted', cost })
  console.log(JSON.stringify({ run: name, aborted: blocked, cost_usd: Number(cost.toFixed(4)) }))
  process.exit(1)
}
writePredictions(name, predictions)
recordCost({ run: name, ref: 'sync', cost })
const failed = predictions.filter(p => p.p_ask === null).length
console.log(JSON.stringify({ run: name, records: predictions.length, failed, cost_usd: Number(cost.toFixed(4)), spent_usd: Number(spent().toFixed(4)) }))
