import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { queryModelWithStreaming } from '../../services/api/claude.js'
import { createUserMessage } from '../../utils/messages.js'
import { type CliModelRules, MODEL_RULES_ENV_KEY } from '../../utils/model/modelRules.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { handleProxyRequest } from '../proxy/handler.js'
import { ProviderService } from '../services/providerService.js'
import type { ApiFormat } from '../types/provider.js'

const ENV_KEYS = [
  MODEL_RULES_ENV_KEY,
  'DREAMCODER_CONFIG_DIR',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'CLAUDE_CODE_MAX_RETRIES',
  'CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK',
  'CLAUDE_CODE_TEST_FIXTURES_ROOT',
  'VCR_RECORD',
] as const

const UPSTREAM_HOSTS = ['https://api.deepseek.com', 'https://openrouter.ai', 'https://api.openai.com']

const thinks: CliModelRules = {
  contextWindow: 1_000_000,
  thinkingWhenOn: 'adaptive',
  thinkingWhenOff: 'disabled',
  effortLevels: ['low', 'high', 'max'],
  pdf: false,
  image: true,
  nativeWebSearch: false,
  structuredOutput: false,
}

type Body = Record<string, unknown>
type Message = Parameters<typeof queryModelWithStreaming>[0]['messages'][number]
type ContentBlock = { type: string; signature?: string }
type AssistantMessage = Message & { type: 'assistant'; message: { content: ContentBlock[] } }
type UpstreamCall = { url: string; body: Body }

let saved: Record<string, string | undefined>
let workDir: string
let proxy: ReturnType<typeof Bun.serve> | undefined
let originalFetch: typeof globalThis.fetch
let upstreamCalls: UpstreamCall[]
let upstreamReplies: string[]
let promptCounter = 0
let turnCounter = 0

function chatChunk(id: string, delta: Body, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created: 0, model: 'm',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(finishReason && { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
  })}\n\n`
}

function toolCallDelta(callId: string): Body {
  return { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: 'Weather', arguments: '{}' } }] }
}

function chatReply(id: string, reasoning: Body[], callId: string): string {
  return [
    ...reasoning.map((delta, i) => chatChunk(id, i === 0 ? { role: 'assistant', ...delta } : delta)),
    chatChunk(id, toolCallDelta(callId)),
    chatChunk(id, {}, 'tool_calls'),
    'data: [DONE]\n\n',
  ].join('')
}

function responsesEvent(event: string, data: Body): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`
}

function responsesReply(callId: string, summary: string): string {
  const reasoning = { type: 'reasoning', id: 'rs_1' }
  const call = { type: 'function_call', id: 'fc_1', call_id: callId, name: 'Weather', arguments: '{}' }
  const summaryEvents = summary
    ? [
        responsesEvent('response.reasoning_summary_text.delta', { item_id: 'rs_1', delta: summary }),
        responsesEvent('response.reasoning_summary_text.done', { item_id: 'rs_1', text: summary }),
      ]
    : []
  return [
    responsesEvent('response.created', { response: { id: 'resp_1', status: 'in_progress' } }),
    responsesEvent('response.output_item.added', { output_index: 0, item: reasoning }),
    ...summaryEvents,
    responsesEvent('response.output_item.done', {
      output_index: 0,
      item: { ...reasoning, summary: summary ? [{ type: 'summary_text', text: summary }] : [], encrypted_content: 'enc-secret' },
    }),
    responsesEvent('response.output_item.added', { output_index: 1, item: { ...call, arguments: '' } }),
    responsesEvent('response.function_call_arguments.done', { item_id: 'fc_1', arguments: '{}' }),
    responsesEvent('response.output_item.done', { output_index: 1, item: call }),
    responsesEvent('response.completed', { response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } } }),
  ].join('')
}

function fakeUpstream(url: string, init: RequestInit | undefined): Response {
  if ((init?.method ?? 'GET') === 'GET') return Response.json({ data: [] })
  upstreamCalls.push({ url, body: JSON.parse(String(init?.body)) as Body })
  const reply = upstreamReplies.shift()
  if (!reply) return Response.json({ error: { message: 'no scripted reply' } }, { status: 500 })
  return new Response(reply, { headers: { 'Content-Type': 'text/event-stream' } })
}

async function addProvider(baseUrl: string, apiFormat: ApiFormat, model: string): Promise<string> {
  const provider = await new ProviderService().addProvider({
    presetId: 'custom',
    name: `${baseUrl} ${apiFormat}`,
    baseUrl,
    apiKey: 'sk-test',
    apiFormat,
    runtimeKind: 'anthropic_compatible',
    models: [{ id: model }],
  })
  return provider.id
}

function useProvider(providerId: string): void {
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxy!.port}/proxy/providers/${providerId}`
}

async function cliTurn(model: string, messages: Message[]): Promise<AssistantMessage[]> {
  turnCounter += 1
  process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = join(workDir, 'fixtures', String(turnCounter))
  const produced: AssistantMessage[] = []
  for await (const message of queryModelWithStreaming({
    messages,
    systemPrompt: asSystemPrompt(['You are a test.']),
    thinkingConfig: { type: 'adaptive' },
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
      effortValue: 'high',
    },
  })) {
    if (message.type === 'assistant') produced.push(message as AssistantMessage)
  }
  return JSON.parse(JSON.stringify(produced)) as AssistantMessage[]
}

function toolResult(callId: string): Message {
  return createUserMessage({ content: [{ type: 'tool_result', tool_use_id: callId, content: 'sunny' }] })
}

function firstPrompt(): Message {
  promptCounter += 1
  return createUserMessage({ content: `weather ${promptCounter}?` })
}

function assistantMessages(call: UpstreamCall): Body[] {
  return (call.body.messages as Body[]).filter(message => message.role === 'assistant')
}

function thinkingSignatures(messages: AssistantMessage[]): string[] {
  return messages.flatMap(message => message.message.content.flatMap((block: ContentBlock) =>
    block.type === 'thinking' ? [block.signature ?? ''] : []))
}

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]))
  for (const key of ENV_KEYS) delete process.env[key]
  workDir = await mkdtemp(join(tmpdir(), 'proxy-reasoning-roundtrip-'))
  process.env.DREAMCODER_CONFIG_DIR = join(workDir, 'config')
  process.env.VCR_RECORD = '1'
  process.env.ANTHROPIC_API_KEY = 'sk-test'
  process.env.CLAUDE_CODE_MAX_RETRIES = '0'
  process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
  process.env[MODEL_RULES_ENV_KEY] = JSON.stringify({
    models: { 'deepseek-v4-pro': thinks, 'deepseek/deepseek-v4-pro': thinks, 'gpt-5.1': { ...thinks, effortLevels: ['low', 'medium', 'high'] } },
    fallback: { ...thinks, thinkingWhenOn: 'omit', thinkingWhenOff: 'omit', effortLevels: [] },
    defaultEffort: 'medium',
  })
  upstreamCalls = []
  upstreamReplies = []
  originalFetch = globalThis.fetch
  const passThrough = originalFetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (UPSTREAM_HOSTS.some(host => url.startsWith(host))) return fakeUpstream(url, init)
    return passThrough(input, init)
  }) as typeof fetch
  proxy = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: request => handleProxyRequest(request, new URL(request.url), { timeout() {} }),
  })
})

afterEach(async () => {
  proxy?.stop(true)
  proxy = undefined
  globalThis.fetch = originalFetch
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  await rm(workDir, { recursive: true, force: true })
})

describe('reasoning round trip through the CLI', () => {
  test('DeepSeek gets every earlier reasoning_content back in a multi-turn tool loop', async () => {
    useProvider(await addProvider('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro'))
    upstreamReplies.push(
      chatReply('turn-1', [{ reasoning_content: 'First, ' }, { reasoning_content: 'call weather.' }], 'call_1'),
      chatReply('turn-2', [{ reasoning_content: 'Check again.' }], 'call_2'),
      `${chatChunk('turn-3', { role: 'assistant', content: 'Sunny.' })}${chatChunk('turn-3', {}, 'stop')}data: [DONE]\n\n`,
    )

    const history: Message[] = [firstPrompt()]
    const turn1 = await cliTurn('deepseek-v4-pro', history)
    expect(thinkingSignatures(turn1)).toEqual(['dc1:reasoning_content:'])
    history.push(...turn1, toolResult('call_1'))
    const turn2 = await cliTurn('deepseek-v4-pro', history)
    history.push(...turn2, toolResult('call_2'))
    await cliTurn('deepseek-v4-pro', history)

    expect(upstreamCalls).toHaveLength(3)
    expect(upstreamCalls[0]!.body.thinking).toEqual({ type: 'enabled' })
    expect(upstreamCalls[0]!.body.reasoning_effort).toBe('high')
    expect(assistantMessages(upstreamCalls[1]!).map(message => message.reasoning_content)).toEqual(['First, call weather.'])
    expect(assistantMessages(upstreamCalls[2]!).map(message => message.reasoning_content)).toEqual([
      'First, call weather.',
      'Check again.',
    ])
  })

  test('chunked OpenRouter reasoning_details come back whole, then as reasoning_content after switching to DeepSeek', async () => {
    const openrouter = await addProvider('https://openrouter.ai/api/v1', 'openai_chat', 'deepseek/deepseek-v4-pro')
    const deepseek = await addProvider('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro')
    const detail = (text: string, extra: Body = {}) => ({ reasoning_details: [{ type: 'reasoning.text', text, index: 0, format: 'unknown', ...extra }] })
    upstreamReplies.push(
      chatReply('or-1', [
        { reasoning: 'Look ', ...detail('Look ') },
        { reasoning: 'it up.', ...detail('it up.') },
        detail('', { signature: 'sig-or' }),
      ], 'call_1'),
      chatReply('or-2', [{ reasoning: 'Again.', ...detail('Again.', { signature: 'sig-2' }) }], 'call_2'),
      chatReply('ds-3', [{ reasoning_content: 'Native.' }], 'call_3'),
    )

    useProvider(openrouter)
    const history: Message[] = [firstPrompt()]
    const turn1 = await cliTurn('deepseek/deepseek-v4-pro', history)
    history.push(...turn1, toolResult('call_1'))
    const turn2 = await cliTurn('deepseek/deepseek-v4-pro', history)
    history.push(...turn2, toolResult('call_2'))

    expect(assistantMessages(upstreamCalls[1]!)[0]!.reasoning_details).toEqual([
      { type: 'reasoning.text', text: 'Look it up.', index: 0, format: 'unknown', signature: 'sig-or' },
    ])
    expect(upstreamCalls[0]!.body.reasoning).toEqual({ effort: 'high' })

    useProvider(deepseek)
    await cliTurn('deepseek-v4-pro', history)
    const switched = assistantMessages(upstreamCalls[2]!)
    expect(switched.map(message => message.reasoning_content)).toEqual(['Look it up.', 'Again.'])
    expect(switched.every(message => message.reasoning_details === undefined)).toBe(true)
  })

  test.each([
    ['with a summary', 'Plan the call'],
    ['without a summary', ''],
  ])('Responses encrypted reasoning %s comes back as a reasoning item before the call', async (_name, summary) => {
    useProvider(await addProvider('https://api.openai.com/v1', 'openai_responses', 'gpt-5.1'))
    upstreamReplies.push(responsesReply('call_1', summary), responsesReply('call_2', summary))

    const history: Message[] = [firstPrompt()]
    const turn1 = await cliTurn('gpt-5.1', history)
    expect(thinkingSignatures(turn1)).toEqual(['dc1:encrypted_content:enc-secret'])
    history.push(...turn1, toolResult('call_1'))
    await cliTurn('gpt-5.1', history)

    expect(upstreamCalls[0]!.body.include).toEqual(['reasoning.encrypted_content'])
    const input = upstreamCalls[1]!.body.input as Body[]
    const reasoningAt = input.findIndex(item => item.type === 'reasoning')
    expect(input[reasoningAt]).toEqual({
      type: 'reasoning',
      summary: summary ? [{ type: 'summary_text', text: summary }] : [],
      encrypted_content: 'enc-secret',
    })
    expect(input[reasoningAt + 1]).toMatchObject({ type: 'function_call', call_id: 'call_1' })
  })

  test('thinking from an older session without a mark is written back on DeepSeek only', async () => {
    const deepseek = await addProvider('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro')
    const openrouter = await addProvider('https://openrouter.ai/api/v1', 'openai_chat', 'deepseek/deepseek-v4-pro')
    useProvider(deepseek)
    upstreamReplies.push(chatReply('old-1', [{ reasoning_content: 'Old.' }], 'call_1'))
    const turn1 = await cliTurn('deepseek-v4-pro', [firstPrompt()])
    const unmarked = turn1.map(message => ({
      ...message,
      message: {
        ...message.message,
        content: message.message.content.map((block: ContentBlock) => block.type === 'thinking' ? { ...block, signature: '' } : block),
      },
    })) as AssistantMessage[]
    const history: Message[] = [firstPrompt(), ...unmarked, toolResult('call_1')]

    upstreamReplies.push(chatReply('old-2', [{ reasoning_content: 'x' }], 'call_2'))
    await cliTurn('deepseek-v4-pro', history)
    expect(assistantMessages(upstreamCalls[1]!)[0]!.reasoning_content).toBe('Old.')

    useProvider(openrouter)
    upstreamReplies.push(chatReply('old-3', [{ reasoning: 'y' }], 'call_3'))
    await cliTurn('deepseek/deepseek-v4-pro', history)
    const assistant = assistantMessages(upstreamCalls[2]!)[0]!
    expect(assistant.reasoning_content).toBeUndefined()
    expect(assistant.reasoning_details).toBeUndefined()
  })
})
