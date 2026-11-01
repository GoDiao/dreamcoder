import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Candidate } from './candidates'
import type { Curation } from './convert'
import { buildMessages, readDrafts, renderReview, runDescribe, sanitizeHtml, validateModelDraft, type ModelDeps } from './describe'

const KEY = 'redaction-test-value-0123456789'
const MODEL = 'vendor/model-x'

const good = (overrides: Record<string, unknown> = {}) => ({
  fit: 'page',
  fitReason: 'A web page.',
  category: 'web',
  acceptsDesignSystem: true,
  acceptsReason: 'Colors are variables.',
  title: { en: 'Demo page', zh: '演示页' },
  descriptionZh: '一个演示页面。',
  tags: ['demo', 'landing', 'marketing'],
  prompt: { en: 'Keep the hero and the pricing grid.', zh: '保留主视觉和定价栅格。' },
  style: { en: 'Light and airy with one blue accent.', zh: '明亮疏朗，只有一种蓝色强调。' },
  ...overrides,
})

const skill = `---
name: demo
description: |
  A demo page with a hero.
od:
  mode: prototype
  platform: desktop
  scenario: marketing
---
# Demo
Body text.
`

const examples: Curation = {
  sourceRepo: 'https://example.com/r',
  templates: {
    sample: {
      category: 'web',
      acceptsDesignSystem: true,
      title: { en: 'Sample', zh: '样例' },
      descriptionZh: '样例简介',
      tags: ['a'],
      prompt: { en: 'keep', zh: '保留' },
      style: { en: 'Sample style.', zh: '样例风格。' },
    },
  },
}

let root: string
let checkout: string
let out: string
let logs: string[]
let sleeps: number[]

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  sourceDir: 'design-templates',
  mode: 'prototype',
  platform: 'desktop',
  scenario: 'marketing',
  bytes: 20,
  relativeReferences: [],
  ...overrides,
})

async function addTemplate(id: string, sourceDir = 'design-templates') {
  const folder = path.join(checkout, sourceDir, id)
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'SKILL.md'), skill)
  await fs.writeFile(path.join(folder, 'example.html'), `<h1>${id}</h1>`)
}

type Reply = { status?: number; body?: unknown; raw?: string; throws?: string }

function fakeFetch(reply: (id: string, call: number, request: { url: string; init: RequestInit }) => Reply, pricing = { prompt: '0.000001', completion: '0.000002' }) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const perTemplate = new Map<string, number>()
  let inFlight = 0
  let maxInFlight = 0
  const fn: ModelDeps['fetch'] = async (url, init) => {
    calls.push({ url, init: init ?? {} })
    if (url.endsWith('/models')) return Response.json({ data: [{ id: MODEL, pricing }] })
    const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
    const id = /Template to describe: (\S+)/.exec(request.messages[1]!.content)![1]!
    const call = (perTemplate.get(id) ?? 0) + 1
    perTemplate.set(id, call)
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise(done => setTimeout(done, 5))
    inFlight -= 1
    const answer = reply(id, call, { url, init: init ?? {} })
    if (answer.throws) throw new Error(answer.throws)
    if (answer.raw !== undefined) return new Response(answer.raw, { status: answer.status ?? 200 })
    return Response.json(answer.body, { status: answer.status ?? 200 })
  }
  return { fn, calls, perTemplate, maxInFlight: () => maxInFlight }
}

const completion = (content: unknown, usage = { prompt_tokens: 100, completion_tokens: 50 }) => ({
  choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  usage,
})

const run = (fetchFn: ModelDeps['fetch'], candidates: Candidate[], concurrency = 2) =>
  runDescribe({
    checkout,
    candidates,
    outDir: out,
    curation: examples,
    deps: { fetch: fetchFn, apiKey: KEY, model: MODEL, sleep: async ms => void sleeps.push(ms) },
    concurrency,
    log: message => void logs.push(message),
  })

async function everythingWritten(): Promise<string> {
  const files = (await fs.readdir(out, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile())
  const texts = await Promise.all(files.map(entry => fs.readFile(path.join(entry.parentPath, entry.name), 'utf-8')))
  return texts.join('\n')
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-describe-'))
  checkout = path.join(root, 'open-design')
  out = path.join(root, 'out')
  logs = []
  sleeps = []
  await addTemplate('alpha')
  await addTemplate('beta')
  await addTemplate('gamma', 'skills')
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('sanitizeHtml', () => {
  it('drops script bodies, path data, base64 data, long inline styles and oversized style blocks', () => {
    const html = [
      '<script>const secret = 1</script>',
      '<svg><path d="M0 0L10 10 L20 20" fill="red"/></svg>',
      '<img src="data:image/png;base64,AAAABBBBCCCC">',
      `<div style="${'color:red;'.repeat(60)}">x</div>`,
      `<style>${'a{b:c}'.repeat(3000)}</style>`,
    ].join('\n')
    const cleaned = sanitizeHtml(html)
    expect(cleaned).not.toContain('const secret')
    expect(cleaned).not.toContain('M0 0L10')
    expect(cleaned).toContain('fill="red"')
    expect(cleaned).not.toContain('AAAABBBB')
    expect(cleaned).toContain('data:base64')
    expect(cleaned).not.toContain('color:red;'.repeat(60))
    expect(cleaned.length).toBeLessThan(html.length)
  })

  it('truncates to the limit and says so', () => {
    const cleaned = sanitizeHtml(`<p>${'x'.repeat(500)}</p>`, 100)
    expect(cleaned.length).toBeLessThan(150)
    expect(cleaned).toContain('truncated')
  })
})

describe('validateModelDraft', () => {
  it('accepts a complete answer', () => {
    expect(validateModelDraft(good())).toEqual({ draft: good() })
  })

  it('names every problem it finds', () => {
    const result = validateModelDraft(
      good({
        fit: 'banner',
        category: 'poster',
        acceptsDesignSystem: 'yes',
        tags: ['One', 'two'],
        title: { en: 'x' },
        style: { en: 'Two\nlines.', zh: '一' },
      }),
    )
    expect('problems' in result && result.problems.join('|')).toContain('fit must be one of')
    expect('problems' in result && result.problems.join('|')).toContain('category must be web or prototype')
    expect('problems' in result && result.problems.join('|')).toContain('acceptsDesignSystem must be a boolean')
    expect('problems' in result && result.problems.join('|')).toContain('tags must be 3 to 5')
    expect('problems' in result && result.problems.join('|')).toContain('title needs')
    expect('problems' in result && result.problems.join('|')).toContain('one line')
  })

  it('rejects an answer that is not an object', () => {
    expect(validateModelDraft([1])).toEqual({ problems: ['the answer is not a JSON object'] })
    expect(validateModelDraft(null)).toEqual({ problems: ['the answer is not a JSON object'] })
  })
})

describe('buildMessages', () => {
  it('sends the instructions, the approved examples and the cleaned material', () => {
    const messages = buildMessages('INSTRUCTIONS', examples, candidate('alpha', { relativeReferences: ['./x.html'] }), { skill: 'SKILL BODY', metadataText: '', html: '<h1>cleaned</h1>' })
    expect(messages[0]).toEqual({ role: 'system', content: 'INSTRUCTIONS' })
    expect(messages[1]!.content).toContain('"id": "sample"')
    expect(messages[1]!.content).toContain('Template to describe: alpha')
    expect(messages[1]!.content).toContain('references other files: ./x.html')
    expect(messages[1]!.content).toContain('SKILL BODY')
    expect(messages[1]!.content).toContain('<h1>cleaned</h1>')
  })
})

describe('runDescribe', () => {
  it('writes a draft per template with its usage, a review file, the usage file and an estimated cost', async () => {
    const api = fakeFetch(() => ({ body: completion(good()) }))
    const result = await run(api.fn, [candidate('alpha'), candidate('beta'), candidate('gamma', { sourceDir: 'skills' })])
    expect(result.failures).toEqual([])
    expect(result.drafts.map(draft => `${draft.sourceDir}/${draft.id}`).sort()).toEqual(['design-templates/alpha', 'design-templates/beta', 'skills/gamma'])
    expect(result.drafts[0]).toMatchObject({ model: MODEL, usage: { promptTokens: 100, completionTokens: 50 }, fit: 'page' })
    expect(result.drafts[0]!.indexChars).toBeGreaterThan(50)
    expect(result.usage).toEqual({ promptTokens: 300, completionTokens: 150 })
    expect(result.cost).toBeCloseTo(300 * 0.000001 + 150 * 0.000002, 10)
    const usageFile = JSON.parse(await fs.readFile(path.join(out, 'usage.json'), 'utf-8'))
    expect(usageFile).toMatchObject({ model: MODEL, promptTokens: 300, completionTokens: 150 })
    expect(usageFile.perTemplate).toHaveLength(3)
    const review = await fs.readFile(path.join(out, 'review.md'), 'utf-8')
    expect(review).toContain('### alpha')
    expect(review).toContain('Template index size if every page draft is accepted')
  })

  it('asks for json, sends the model and the key only in the authorization header', async () => {
    const api = fakeFetch(() => ({ body: completion(good()) }))
    await run(api.fn, [candidate('alpha')])
    const chat = api.calls.find(call => call.url.endsWith('/chat/completions'))!
    const body = JSON.parse(String(chat.init.body))
    expect(body.model).toBe(MODEL)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect((chat.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect(chat.url).not.toContain(KEY)
    expect(String(chat.init.body)).not.toContain(KEY)
  })

  it('retries an answer that is not valid JSON or fails validation, and adds up the tokens', async () => {
    const api = fakeFetch((_id, call) => ({ body: completion(call === 1 ? 'not json at all' : call === 2 ? good({ fit: 'banner' }) : good()) }))
    const result = await run(api.fn, [candidate('alpha')])
    expect(result.failures).toEqual([])
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]!.usage).toEqual({ promptTokens: 300, completionTokens: 150 })
    expect(sleeps).toEqual([1000, 2000])
    const second = JSON.parse(String(api.calls.filter(call => call.url.endsWith('/chat/completions'))[2]!.init.body)).messages
    expect(second.at(-1).content).toContain('fit must be one of')
  })

  it('records a template that never gets a valid answer in the failure list and carries on with the others', async () => {
    const api = fakeFetch(id => ({ body: completion(id === 'alpha' ? { nonsense: true } : good()) }))
    const result = await run(api.fn, [candidate('alpha'), candidate('beta')])
    expect(result.drafts.map(draft => draft.id)).toEqual(['beta'])
    expect(result.failures).toEqual([{ id: 'alpha', sourceDir: 'design-templates', error: expect.stringContaining('fit must be one of') }])
    expect(JSON.parse(await fs.readFile(path.join(out, 'failures.json'), 'utf-8'))).toHaveLength(1)
    expect((await fs.readdir(path.join(out, 'drafts'))).sort()).toEqual(['design-templates--beta.json'])
    expect(result.usage.promptTokens).toBe(100 + 300)
    expect(await fs.readFile(path.join(out, 'review.md'), 'utf-8')).toContain('## Failed')
  })

  it('retries http errors with a backoff before giving up', async () => {
    const api = fakeFetch((_id, call) => (call < 3 ? { status: 503, raw: 'overloaded' } : { body: completion(good()) }))
    const result = await run(api.fn, [candidate('alpha')])
    expect(result.drafts).toHaveLength(1)
    expect(sleeps).toEqual([1000, 2000])
  })

  it('skips templates that already have a draft, so an interrupted run can continue', async () => {
    const first = fakeFetch(() => ({ body: completion(good()) }))
    await run(first.fn, [candidate('alpha')])
    const second = fakeFetch(() => ({ body: completion(good()) }))
    const result = await run(second.fn, [candidate('alpha'), candidate('beta')])
    expect([...second.perTemplate.keys()]).toEqual(['beta'])
    expect(result.drafts.map(draft => draft.id).sort()).toEqual(['alpha', 'beta'])
    expect(result.usage).toEqual({ promptTokens: 200, completionTokens: 100 })
  })

  it('runs at most the given number of requests at once', async () => {
    const api = fakeFetch(() => ({ body: completion(good()) }))
    await run(api.fn, [candidate('alpha'), candidate('beta'), candidate('gamma', { sourceDir: 'skills' })], 2)
    expect(api.maxInFlight()).toBe(2)
  })

  it('leaves the cost out when the model has no price', async () => {
    const api = fakeFetch(() => ({ body: completion(good()) }), { prompt: 'x', completion: 'y' })
    const result = await run(api.fn, [candidate('alpha')])
    expect(result.cost).toBeNull()
    expect(await fs.readFile(path.join(out, 'review.md'), 'utf-8')).not.toContain('estimated cost')
  })

  it('never lets the key into errors, logs or written files', async () => {
    const echoing = fakeFetch((id) =>
      id === 'alpha'
        ? { status: 401, raw: `{"error":"Invalid API key ${KEY} for this request"}` }
        : id === 'beta'
          ? { throws: `connect failed with header Bearer ${KEY}` }
          : { body: completion(good()) },
    )
    const result = await run(echoing.fn, [candidate('alpha'), candidate('beta'), candidate('gamma', { sourceDir: 'skills' })])
    expect(result.failures).toHaveLength(2)
    for (const failure of result.failures) {
      expect(failure.error).not.toContain(KEY)
      expect(failure.error).toContain('[redacted]')
    }
    expect(logs.join('\n')).not.toContain(KEY)
    expect(await everythingWritten()).not.toContain(KEY)
  })
})

describe('renderReview', () => {
  it('puts templates that are not pages or that reference other files first', async () => {
    const api = fakeFetch(id => ({ body: completion(id === 'beta' ? good({ fit: 'video' }) : good()) }))
    await run(api.fn, [candidate('alpha'), candidate('beta'), candidate('gamma', { sourceDir: 'skills', relativeReferences: ['./assets/template.html'] })])
    const review = renderReview(await readDrafts(path.join(out, 'drafts')), [], null)
    const attention = review.indexOf('## Needs attention')
    const pages = review.indexOf('## Page drafts')
    expect(attention).toBeGreaterThan(-1)
    expect(review.indexOf('### beta')).toBeGreaterThan(attention)
    expect(review.indexOf('### beta')).toBeLessThan(pages)
    expect(review.indexOf('### gamma')).toBeLessThan(pages)
    expect(review.indexOf('### alpha')).toBeGreaterThan(pages)
    expect(review).toContain('references other files: ./assets/template.html')
    expect(review).toContain('2 with fit page')
  })
})
