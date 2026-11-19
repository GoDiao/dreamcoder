import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { EffortValue } from '../../../utils/effort.js'
import { createUserMessage } from '../../../utils/messages.js'
import { type CliModelRules, type CliModelRulesEnv, MODEL_RULES_ENV_KEY } from '../../../utils/model/modelRules.js'
import { sideQuery } from '../../../utils/sideQuery.js'
import { asSystemPrompt } from '../../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../../utils/thinking.js'
import { queryHaiku, queryModelWithStreaming } from '../claude.js'

const ENV_KEYS = [
  MODEL_RULES_ENV_KEY,
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_MAX_RETRIES',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_DISABLE_THINKING',
  'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING',
  'CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK',
  'CLAUDE_CODE_TEST_FIXTURES_ROOT',
  'VCR_RECORD',
] as const

const none: CliModelRules = {
  contextWindow: 131_072,
  thinkingWhenOn: 'omit',
  thinkingWhenOff: 'omit',
  effortLevels: [],
  pdf: false,
  image: true,
  nativeWebSearch: false,
  structuredOutput: false,
}

const deepseek: CliModelRules = {
  ...none,
  contextWindow: 1_000_000,
  thinkingWhenOn: 'adaptive',
  thinkingWhenOff: 'disabled',
  effortLevels: ['low', 'high', 'max'],
}

const alwaysThinks: CliModelRules = {
  ...none,
  contextWindow: 400_000,
  thinkingWhenOn: 'adaptive',
  thinkingWhenOff: 'omit',
  effortLevels: ['low', 'medium', 'high'],
  structuredOutput: true,
}

const budget: CliModelRules = {
  ...none,
  maxOutputTokens: 16_000,
  thinkingWhenOn: 'budget',
  thinkingWhenOff: 'disabled',
}

const disableOnly: CliModelRules = { ...none, thinkingWhenOff: 'disabled' }

const MODELS: Record<string, CliModelRules> = {
  'deepseek-v4-pro': deepseek,
  'gpt-5': alwaysThinks,
  'budget-model': budget,
  'kimi-k3': disableOnly,
  'claude-sonnet-4-6': none,
}

type Captured = { body: Record<string, unknown>; beta: string }

let saved: Record<string, string | undefined>
let fixturesDir: string
let server: ReturnType<typeof Bun.serve> | undefined
let captured: Captured[]
let promptCounter = 0

function sse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`
}

function streamedReply(): string {
  return sse('message_start', {
    message: {
      id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'm',
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 },
    },
  })
    + sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    + sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ok' } })
    + sse('content_block_stop', { index: 0 })
    + sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
    + sse('message_stop', {})
}

const jsonReply = {
  id: 'msg_1', type: 'message', role: 'assistant', model: 'm',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 },
}

function setRules(env: Partial<CliModelRulesEnv> = {}) {
  const value: CliModelRulesEnv = { models: MODELS, fallback: none, defaultEffort: 'medium', ...env }
  process.env[MODEL_RULES_ENV_KEY] = JSON.stringify(value)
}

function nextPrompt(): string {
  promptCounter += 1
  return `request ${promptCounter}`
}

function last(): Captured {
  return captured.at(-1)!
}

function outputConfig(): Record<string, unknown> | undefined {
  return last().body.output_config as Record<string, unknown> | undefined
}

async function mainTurn(model: string, options: { thinking: boolean; effortValue?: EffortValue; outputFormat?: boolean }) {
  const thinkingConfig: ThinkingConfig = options.thinking ? { type: 'adaptive' } : { type: 'disabled' }
  for await (const _ of queryModelWithStreaming({
    messages: [createUserMessage({ content: nextPrompt() })],
    systemPrompt: asSystemPrompt(['You are a test.']),
    thinkingConfig,
    tools: [],
    signal: new AbortController().signal,
    options: {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      model,
      isNonInteractiveSession: true,
      querySource: 'sdk',
      agents: [],
      hasAppendSystemPrompt: false,
      mcpTools: [],
      ...(options.effortValue !== undefined && { effortValue: options.effortValue }),
      ...(options.outputFormat && { outputFormat: { type: 'json_schema', schema: { type: 'object' } } }),
    },
  })) {
    void _
  }
  return last()
}

async function haiku(model: string, effortValue?: EffortValue) {
  process.env.ANTHROPIC_SMALL_FAST_MODEL = model
  await queryHaiku({
    systemPrompt: asSystemPrompt(['You are a test.']),
    userPrompt: nextPrompt(),
    signal: new AbortController().signal,
    options: {
      isNonInteractiveSession: true,
      querySource: 'sdk',
      agents: [],
      hasAppendSystemPrompt: false,
      mcpTools: [],
      ...(effortValue !== undefined && { effortValue }),
    },
  })
  return last()
}

async function side(model: string, extra: { thinking?: number | false; outputFormat?: boolean } = {}) {
  await sideQuery({
    querySource: 'sdk',
    model,
    messages: [{ role: 'user', content: nextPrompt() }],
    ...(extra.thinking !== undefined && { thinking: extra.thinking }),
    ...(extra.outputFormat && { output_format: { type: 'json_schema', schema: { type: 'object' } } }),
  })
  return last()
}

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
  for (const key of ENV_KEYS) delete process.env[key]
  fixturesDir = await mkdtemp(join(tmpdir(), 'model-rules-request-'))
  captured = []
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>
      captured.push({ body, beta: request.headers.get('anthropic-beta') ?? '' })
      if (body.stream === true) {
        return new Response(streamedReply(), { headers: { 'content-type': 'text/event-stream' } })
      }
      return Response.json(jsonReply)
    },
  })
  process.env.ANTHROPIC_API_KEY = 'sk-test'
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.port}`
  process.env.CLAUDE_CODE_MAX_RETRIES = '0'
  process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
  process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = fixturesDir
  process.env.VCR_RECORD = '1'
  setRules()
})

afterEach(async () => {
  server?.stop(true)
  server = undefined
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  await rm(fixturesDir, { recursive: true, force: true })
})

describe('main conversation thinking and effort', () => {
  test('a model that always thinks never gets disabled thinking and keeps its effort', async () => {
    const on = await mainTurn('gpt-5', { thinking: true, effortValue: 'high' })
    expect(on.body.thinking).toEqual({ type: 'adaptive' })
    expect((on.body.output_config as Record<string, unknown>).effort).toBe('high')

    const off = await mainTurn('gpt-5', { thinking: false, effortValue: 'high' })
    expect(off.body.thinking).toBeUndefined()
    expect(outputConfig()?.effort).toBe('high')
  })

  test('a toggle model sends disabled thinking without effort when thinking is off', async () => {
    const off = await mainTurn('deepseek-v4-pro', { thinking: false, effortValue: 'high' })
    expect(off.body.thinking).toEqual({ type: 'disabled' })
    expect(outputConfig()?.effort).toBeUndefined()
  })

  test('a budget model sends a thinking budget and no effort', async () => {
    const on = await mainTurn('budget-model', { thinking: true, effortValue: 'high' })
    expect(on.body.thinking).toEqual({ type: 'enabled', budget_tokens: expect.any(Number) })
    expect(outputConfig()?.effort).toBeUndefined()
  })

  test('a disable-only model sends nothing when on and disabled when off, also through the fallback', async () => {
    setRules({ fallback: disableOnly })
    const on = await mainTurn('kimi-for-coding', { thinking: true, effortValue: 'high' })
    expect(on.body.thinking).toBeUndefined()
    expect(outputConfig()?.effort).toBeUndefined()

    const off = await mainTurn('kimi-for-coding', { thinking: false })
    expect(off.body.thinking).toEqual({ type: 'disabled' })
    expect(outputConfig()?.effort).toBeUndefined()
  })

  test('without a session effort the global default is mapped onto the model levels', async () => {
    await mainTurn('deepseek-v4-pro', { thinking: true })
    expect(last().body.thinking).toEqual({ type: 'adaptive' })
    expect(outputConfig()?.effort).toBe('high')

    await mainTurn('gpt-5', { thinking: true })
    expect(outputConfig()?.effort).toBe('medium')
  })

  test('a session effort is mapped onto the model levels', async () => {
    await mainTurn('gpt-5', { thinking: true, effortValue: 'max' })
    expect(outputConfig()?.effort).toBe('high')

    await mainTurn('deepseek-v4-pro', { thinking: true, effortValue: 'low' })
    expect(outputConfig()?.effort).toBe('low')
  })

  test('the global effort from the rules applies when no effort is passed, as for scheduled tasks', async () => {
    setRules({ defaultEffort: 'high' })
    await mainTurn('gpt-5', { thinking: true })
    expect(outputConfig()?.effort).toBe('high')
  })

  test('CLAUDE_CODE_EFFORT_LEVEL still wins', async () => {
    process.env.CLAUDE_CODE_EFFORT_LEVEL = 'low'
    await mainTurn('gpt-5', { thinking: true, effortValue: 'high' })
    expect(outputConfig()?.effort).toBe('low')
  })
})

describe('main conversation format and output limit', () => {
  test('output_config.format is only sent when the model supports structured output', async () => {
    await mainTurn('deepseek-v4-pro', { thinking: true, outputFormat: true })
    expect(outputConfig()?.format).toBeUndefined()

    await mainTurn('gpt-5', { thinking: true, outputFormat: true })
    expect(outputConfig()?.format).toEqual({ type: 'json_schema', schema: { type: 'object' } })
  })

  test('max_tokens follows the model output limit', async () => {
    const turn = await mainTurn('budget-model', { thinking: false })
    expect(turn.body.max_tokens).toBe(16_000)
  })
})

describe('auxiliary calls through queryHaiku', () => {
  test('a model that can turn thinking off gets disabled thinking and no effort', async () => {
    const toggle = await haiku('deepseek-v4-pro', 'high')
    expect(toggle.body.thinking).toEqual({ type: 'disabled' })
    expect(outputConfig()?.effort).toBeUndefined()

    setRules({ fallback: disableOnly })
    const fallback = await haiku('kimi-for-coding')
    expect(fallback.body.thinking).toEqual({ type: 'disabled' })
  })

  test('a model that always thinks gets its weakest level instead of the session effort', async () => {
    const turn = await haiku('gpt-5', 'high')
    expect(turn.body.thinking).toBeUndefined()
    expect(outputConfig()?.effort).toBe('low')
  })

  test('a model without thinking gets no thinking fields', async () => {
    const turn = await haiku('plain-model', 'high')
    expect(turn.body.thinking).toBeUndefined()
    expect(outputConfig()?.effort).toBeUndefined()
  })
})

describe('auxiliary calls through sideQuery', () => {
  test('a model that can turn thinking off gets disabled thinking', async () => {
    expect((await side('deepseek-v4-pro')).body.thinking).toEqual({ type: 'disabled' })
    expect(outputConfig()).toBeUndefined()

    setRules({ fallback: disableOnly })
    expect((await side('kimi-for-coding')).body.thinking).toEqual({ type: 'disabled' })
  })

  test('a model that always thinks gets its weakest level', async () => {
    const turn = await side('gpt-5')
    expect(turn.body.thinking).toBeUndefined()
    expect(outputConfig()).toEqual({ effort: 'low' })
  })

  test('a model without thinking gets no thinking fields', async () => {
    const turn = await side('plain-model')
    expect(turn.body.thinking).toBeUndefined()
    expect(outputConfig()).toBeUndefined()
  })

  test('a numeric thinking budget turns thinking on with the weakest level', async () => {
    const adaptive = await side('gpt-5', { thinking: 1000 })
    expect(adaptive.body.thinking).toEqual({ type: 'adaptive' })
    expect(outputConfig()).toEqual({ effort: 'low' })

    const withBudget = await side('budget-model', { thinking: 1000 })
    expect(withBudget.body.thinking).toEqual({ type: 'enabled', budget_tokens: 1000 })
    expect(outputConfig()).toBeUndefined()
  })

  test('effort and format share one output_config', async () => {
    await side('gpt-5', { outputFormat: true })
    expect(outputConfig()).toEqual({ effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } })
  })

  test('format is left out when the model has no structured output', async () => {
    await side('deepseek-v4-pro', { outputFormat: true })
    expect(outputConfig()).toBeUndefined()
  })

  test('the structured-outputs beta is left out with the format', async () => {
    const request = await side('claude-sonnet-4-6', { outputFormat: true })
    expect(outputConfig()).toBeUndefined()
    expect(request.beta).not.toContain('structured-outputs-2025-12-15')
  })

  test('interleaved thinking is not requested', async () => {
    expect((await side('deepseek-v4-pro')).beta).not.toContain('interleaved-thinking-2025-05-14')
    expect((await side('kimi-k3')).beta).not.toContain('interleaved-thinking-2025-05-14')
  })
})
