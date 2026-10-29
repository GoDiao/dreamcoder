// Chat-model baseline through OpenRouter: the System 2 reference. Every
// model gets the same system prompt, policy and rendered state, no
// reasoning, and answers with {ask, risk} as structured output.
//
//   bun experiments/system1-guardrail/eval/chat.ts <estimate|run|submit|fetch> \
//     --model anthropic/claude-haiku-5.5 --split dev --view full [--budget 1500] \
//     [--limit 200] [--tag v1] [--cap 8]
//
// run: synchronous requests (full price), for small dev samples while the
//      prompt is being written.
// submit / fetch: OpenRouter's Batch API at batch prices; fetch collects the
//      results once every batch has completed.
//
// The key is read from OPENROUTER_API_KEY and never printed. Only the public
// SABER set may be sent; the private set never leaves the machine.
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parseFlags, sha256, type Split, type ToolCallRecord } from '../dataset/lib'
import { renderState, type View, VIEWS } from './input'
import {
  datasetHashes,
  evalRecords,
  type Prediction,
  readRunMeta,
  recordCost,
  runDir,
  pending,
  spent,
  writePredictions,
  writeRunMeta,
} from './lib'
import { CHAT_SCHEMA, CHAT_SYSTEM, promptHash } from './policy'

const API = 'https://openrouter.ai/api/v1'
const [command, ...rest] = process.argv.slice(2)
const flags = parseFlags(rest)

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is not set')
  return key
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json', ...init.headers },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

type Setup = {
  name: string
  model: string
  split: Split
  view: View
  budget: number | null
  records: ToolCallRecord[]
}

function setup(): Setup {
  const model = flags.get('model')
  if (!model) throw new Error('--model is required')
  const split = (flags.get('split') ?? 'dev') as Split
  const view = (flags.get('view') ?? 'full') as View
  if (!VIEWS.includes(view)) throw new Error(`--view must be one of ${VIEWS.join(', ')}`)
  const budget = flags.has('budget') && flags.get('budget') !== 'none' ? Number(flags.get('budget')) : null
  let records = evalRecords('saber', split)
  // A fixed sample: the same records for every candidate given the same limit.
  const limit = flags.has('limit') ? Number(flags.get('limit')) : null
  if (limit !== null) {
    records = records.sort((a, b) => sha256(a.id).localeCompare(sha256(b.id))).slice(0, limit)
  }
  const tag = flags.get('tag')
  const name = [
    'saber',
    split,
    model.split('/').pop(),
    view,
    budget === null ? 'all' : `b${budget}`,
    ...(limit === null ? [] : [`n${limit}`]),
    ...(tag ? [tag] : []),
  ].join('-')
  return { name, model, split, view, budget, records }
}

function body(record: ToolCallRecord, s: Setup) {
  return {
    messages: [
      { role: 'system', content: CHAT_SYSTEM },
      { role: 'user', content: renderState(record, s.view, s.budget) },
    ],
    max_tokens: 64,
    reasoning: { enabled: false },
    response_format: CHAT_SCHEMA,
  }
}

function parse(id: string, content: unknown): Prediction {
  try {
    const answer = JSON.parse(String(content))
    if (typeof answer.ask !== 'boolean' || typeof answer.risk !== 'number') throw new Error('bad shape')
    return { id, p_ask: Math.min(1, Math.max(0, answer.risk / 100)), decision: answer.ask ? 'ask' : 'allow' }
  } catch {
    return { id, p_ask: null, decision: null, error: `unparsed: ${String(content).slice(0, 200)}` }
  }
}

function startRun(s: Setup, mode: 'sync' | 'batch', estCost: number): void {
  writeRunMeta({
    name: s.name,
    candidate: 'chat',
    model: s.model,
    source: 'saber',
    split: s.split,
    view: s.view,
    budget_chars: s.budget,
    prompt_sha256: promptHash(CHAT_SYSTEM, CHAT_SCHEMA),
    dataset: datasetHashes('saber'),
    records: s.records.length,
    created_at: new Date().toISOString(),
    mode,
    est_cost_usd: estCost,
  })
}

/**
 * Prompt tokens are estimated from characters: measured on a dev record,
 * Claude's tokenizer gives about 1.9 characters per token here (code and
 * JSON), OpenAI's about 3.4. The ledger has the real cost.
 */
const charsPerToken = (model: string) => (model.startsWith('anthropic/') ? 1.9 : 3.4)
async function estimate(s: Setup, batch: boolean) {
  const chars = s.records.reduce((n, r) => n + CHAT_SYSTEM.length + renderState(r, s.view, s.budget).length, 0)
  const models = (await (await fetch(`${API}/models`)).json()).data as any[]
  const id = batch ? `${s.model}:batch` : s.model
  const pricing = models.find(m => m.id === id)?.pricing
  if (!pricing) throw new Error(`no pricing for ${id}`)
  const tokens = chars / charsPerToken(s.model)
  const cost = tokens * Number(pricing.prompt) + s.records.length * 20 * Number(pricing.completion)
  return { run: s.name, records: s.records.length, est_prompt_tokens: Math.round(tokens), est_cost_usd: Number(cost.toFixed(3)) }
}

function checkCap(cost: number) {
  const cap = Number(flags.get('cap') ?? 8)
  const already = spent() + pending()
  if (already + cost > cap) {
    throw new Error(`would exceed the $${cap} cap: spent or pending $${already.toFixed(3)}, this run about $${cost.toFixed(3)}`)
  }
}

async function runSync(s: Setup) {
  const { est_cost_usd } = await estimate(s, false)
  checkCap(est_cost_usd)
  startRun(s, 'sync', est_cost_usd)
  const predictions: Prediction[] = new Array(s.records.length)
  let cost = 0
  let next = 0
  const worker = async () => {
    while (next < s.records.length) {
      const i = next++
      const record = s.records[i]!
      const started = performance.now()
      try {
        const response = await api('/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: s.model, ...body(record, s) }),
        })
        cost += Number(response.usage?.cost ?? 0)
        predictions[i] = {
          ...parse(record.id, response.choices?.[0]?.message?.content),
          latency_ms: Math.round(performance.now() - started),
        }
      } catch (error) {
        predictions[i] = { id: record.id, p_ask: null, decision: null, error: String(error).slice(0, 300) }
      }
    }
  }
  await Promise.all(Array.from({ length: Number(flags.get('concurrency') ?? 8) }, worker))
  writePredictions(s.name, predictions)
  recordCost({ run: s.name, ref: 'sync', cost })
  const failed = predictions.filter(p => p.p_ask === null).length
  console.log(JSON.stringify({ run: s.name, records: predictions.length, failed, cost_usd: Number(cost.toFixed(4)), spent_usd: Number(spent().toFixed(4)) }))
}

const CHUNK = 2000

type Batch = { id: string; requests: number; cost_recorded: boolean; failed_ids?: string[] }

async function postChunk(s: Setup, start: number): Promise<string> {
  const chunk = s.records.slice(start, start + CHUNK)
  // endpoint and model must come before requests: the API stream-parses the body.
  const response = await api('/batches', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: '/v1/chat/completions',
      model: `${s.model}:batch`,
      requests: chunk.map(record => ({ custom_id: sha256(record.id).slice(0, 32), body: body(record, s) })),
    }),
  })
  return response.id
}

/**
 * Submits the run in chunks of CHUNK records, chunk i in batches[i].
 * OpenRouter limits rows per minute and rows in flight; when it refuses a
 * chunk the run stops there, and the same command later sends the rest.
 * --retry-failed resubmits chunks whose batch failed, expired or was cancelled.
 */
async function submit(s: Setup) {
  const { est_cost_usd } = await estimate(s, true)
  const path = join(runDir(s.name), 'batches.json')
  const batches: Batch[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
  const save = () => writeFileSync(path, JSON.stringify(batches, null, 2) + '\n')
  const rateLimited = (error: unknown) => String(error).includes(': 429 ')

  if (flags.has('retry-failed')) {
    for (const [i, batch] of batches.entries()) {
      if (!['failed', 'expired', 'cancelled'].includes((await api(`/batches/${batch.id}`)).status)) continue
      try {
        const id = await postChunk(s, i * CHUNK)
        batches[i] = { ...batch, id, failed_ids: [...(batch.failed_ids ?? []), batch.id] }
        save()
      } catch (error) {
        if (!rateLimited(error)) throw error
        console.log(JSON.stringify({ run: s.name, stopped: 'rate limit, run submit --retry-failed again later' }))
        return
      }
    }
    console.log(JSON.stringify({ run: s.name, retried: batches.filter(b => b.failed_ids).length }))
    return
  }

  const done = batches.reduce((n, b) => n + b.requests, 0)
  if (done >= s.records.length) throw new Error(`${s.name} was already submitted`)
  checkCap((est_cost_usd * (s.records.length - done)) / s.records.length)
  if (done === 0) startRun(s, 'batch', est_cost_usd)
  for (let start = done; start < s.records.length; start += CHUNK) {
    try {
      batches.push({ id: await postChunk(s, start), requests: Math.min(CHUNK, s.records.length - start), cost_recorded: false })
      save()
    } catch (error) {
      if (!rateLimited(error)) throw error
      console.log(JSON.stringify({ run: s.name, submitted: start, of: s.records.length, stopped: 'rate limit, run submit again later' }))
      return
    }
  }
  console.log(JSON.stringify({ run: s.name, batches: batches.length, est_cost_usd }))
}

async function fetchRun(name: string) {
  const meta = readRunMeta(name)
  const path = join(runDir(name), 'batches.json')
  const batches = JSON.parse(readFileSync(path, 'utf8')) as { id: string; requests: number; cost_recorded: boolean }[]
  const states = await Promise.all(batches.map(b => api(`/batches/${b.id}`)))
  for (const [i, state] of states.entries()) {
    if (state.status === 'completed' && !batches[i]!.cost_recorded) {
      recordCost({ run: name, ref: state.id, cost: Number(state.usage?.cost ?? 0) })
      batches[i]!.cost_recorded = true
    }
  }
  writeFileSync(path, JSON.stringify(batches, null, 2) + '\n')
  const status = states.map(s => ({ id: s.id, status: s.status, ...s.request_counts }))
  const submitted = batches.reduce((n, b) => n + b.requests, 0) === meta.records
  if (!submitted || !states.every(s => ['completed', 'failed', 'expired', 'cancelled'].includes(s.status))) {
    console.log(JSON.stringify({ run: name, done: false, submitted, status }))
    return
  }
  // Writing predictions with a chunk missing would score a smaller set without saying so.
  if (!states.every(s => s.status === 'completed')) {
    console.log(JSON.stringify({ run: name, done: false, status, next: 'submit --retry-failed, then fetch again' }))
    return
  }
  const byCustomId = new Map<string, any>()
  for (const state of states) for (const result of state.results ?? []) byCustomId.set(result.custom_id, result)
  const records = evalRecords(meta.source, meta.split, { withContext: false })
  const predictions = records.flatMap(({ id }) => {
    const result = byCustomId.get(sha256(id).slice(0, 32))
    if (!result) return []
    if (result.error || !result.response) {
      return [{ id, p_ask: null, decision: null, error: JSON.stringify(result.error).slice(0, 300) } as Prediction]
    }
    return [parse(id, result.response.body?.choices?.[0]?.message?.content)]
  })
  writePredictions(name, predictions)
  const failed = predictions.filter(p => p.p_ask === null).length
  const missing = meta.records - predictions.length
  console.log(JSON.stringify({ run: name, done: true, predictions: predictions.length, failed, missing, status, spent_usd: Number(spent().toFixed(4)) }))
}

switch (command) {
  case 'estimate': {
    const s = setup()
    console.log(JSON.stringify({ ...(await estimate(s, !flags.has('sync'))), batch: !flags.has('sync') }))
    break
  }
  case 'run':
    await runSync(setup())
    break
  case 'submit':
    await submit(setup())
    break
  case 'fetch': {
    const name = flags.get('run')
    if (!name) throw new Error('--run is required')
    await fetchRun(name)
    break
  }
  default:
    console.error('usage: chat.ts <estimate|run|submit|fetch> [flags]')
    process.exit(1)
}
