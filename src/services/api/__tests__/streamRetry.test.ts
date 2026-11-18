import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import * as sessionActivity from '../../../utils/sessionActivity.js'
import { createUserMessage } from '../../../utils/messages.js'
import { asSystemPrompt } from '../../../utils/systemPromptType.js'
import { queryModelWithStreaming } from '../claude.js'

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK',
  'CLAUDE_CODE_MAX_RETRIES',
  'CLAUDE_CODE_TEST_FIXTURES_ROOT',
  'VCR_RECORD',
] as const
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>
let fixturesDir: string
let starts: ReturnType<typeof spyOn>
let stops: ReturnType<typeof spyOn>
let server: ReturnType<typeof Bun.serve> | undefined

function sse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`
}

const messageStart = sse('message_start', {
  message: {
    id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'claude-sonnet-4-5',
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 },
  },
})

function textReply(text: string): string {
  return messageStart
    + sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    + sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
    + sse('content_block_stop', { index: 0 })
    + sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
    + sse('message_stop', {})
}

function brokenReply(errorType: string): string {
  return messageStart
    + sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    + sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Half an ans' } })
    + sse('content_block_stop', { index: 0 })
    + `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: errorType, message: 'the stream broke' } })}\n\n`
}

const overloaded = { status: 500, body: JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'try again' } }) }

type Reply = string | { status: number; body: string } | { openEnded: string }

function reply(body: Reply): Response {
  if (typeof body === 'string') return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  if ('openEnded' in body) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body.openEnded))
      },
    })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
  }
  return new Response(body.body, { status: body.status, headers: { 'content-type': 'application/json' } })
}

function serve(replies: Reply[]): { requests: () => number } {
  let count = 0
  server = Bun.serve({
    port: 0,
    fetch() {
      const next = replies[Math.min(count, replies.length - 1)]!
      count += 1
      return reply(next)
    },
  })
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.port}`
  return { requests: () => count }
}

function abortAfterFirstChunk(controller: AbortController): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init)
    const reader = response.body!.getReader()
    let reads = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        reads += 1
        if (reads > 1) controller.abort()
        try {
          const { done, value } = await reader.read()
          if (done) stream.close()
          else stream.enqueue(value)
        } catch (error) {
          stream.error(error)
        }
      },
    }, { highWaterMark: 0 })
    return new Response(body, { status: response.status, headers: response.headers })
  }) as typeof fetch
}

async function ask(controller = new AbortController(), fetchOverride?: typeof fetch) {
  let fallbacks = 0
  const yielded = []
  for await (const message of queryModelWithStreaming({
    messages: [createUserMessage({ content: 'hello' })],
    systemPrompt: asSystemPrompt(['You are a test.']),
    thinkingConfig: { type: 'disabled' },
    tools: [],
    signal: controller.signal,
    options: {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      model: 'claude-sonnet-4-5',
      isNonInteractiveSession: true,
      querySource: 'sdk',
      agents: [],
      hasAppendSystemPrompt: false,
      mcpTools: [],
      onStreamingFallback: () => {
        fallbacks += 1
      },
      ...(fetchOverride && { fetchOverride }),
    },
  })) {
    yielded.push(message)
  }
  const assistants = yielded.filter((m) => m.type === 'assistant') as Array<{ isApiErrorMessage?: boolean; message: { content: Array<{ type: string; text?: string }> } }>
  const restarts = yielded.filter((m) => m.type === 'system' && (m as { streamRestart?: boolean }).streamRestart === true)
  return { fallbacks, assistants, restarts }
}

describe('retrying a stream that breaks in the middle', () => {
  beforeEach(async () => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
    fixturesDir = await mkdtemp(join(tmpdir(), 'stream-retry-test-'))
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'
    process.env.CLAUDE_CODE_TEST_FIXTURES_ROOT = fixturesDir
    process.env.VCR_RECORD = '1'
    delete process.env.CLAUDE_CODE_MAX_RETRIES
    starts = spyOn(sessionActivity, 'startSessionActivity')
    stops = spyOn(sessionActivity, 'stopSessionActivity')
  })

  afterEach(async () => {
    starts.mockRestore()
    stops.mockRestore()
    server?.stop(true)
    server = undefined
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    await rm(fixturesDir, { recursive: true, force: true })
  })

  test('opens a new stream and returns the complete reply', async () => {
    const endpoint = serve([brokenReply('api_error'), textReply('The full answer.')])

    const { fallbacks, assistants, restarts } = await ask()

    expect(endpoint.requests()).toBe(2)
    expect(fallbacks).toBe(1)
    expect(restarts).toHaveLength(1)
    const last = assistants.at(-1)!
    expect(last.isApiErrorMessage).toBeFalsy()
    expect(last.message.content).toEqual([{ type: 'text', text: 'The full answer.' }])
    expect(starts.mock.calls.length).toBe(stops.mock.calls.length)
  })

  test('treats the user stopping the reply as a stop, not a broken stream to retry', async () => {
    const partial = messageStart
      + sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      + sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Half an ans' } })
    const controller = new AbortController()
    const endpoint = serve([{ openEnded: partial }, textReply('never sent')])

    const { fallbacks, restarts } = await ask(controller, abortAfterFirstChunk(controller))

    expect(endpoint.requests()).toBe(1)
    expect(fallbacks).toBe(0)
    expect(restarts).toHaveLength(0)
  })

  test('does not retry an error the provider will repeat', async () => {
    const endpoint = serve([brokenReply('invalid_request_error'), textReply('never sent')])

    const { fallbacks, assistants } = await ask()

    expect(endpoint.requests()).toBe(1)
    expect(fallbacks).toBe(0)
    expect(assistants.at(-1)!.isApiErrorMessage).toBe(true)
  })

  test('counts stream retries and request retries against one budget', async () => {
    process.env.CLAUDE_CODE_MAX_RETRIES = '2'
    const endpoint = serve([brokenReply('api_error')])

    const { assistants } = await ask()

    expect(endpoint.requests()).toBe(3)
    expect(assistants.at(-1)!.isApiErrorMessage).toBe(true)
  })

  test('leaves request retries only what the broken streams did not use', async () => {
    process.env.CLAUDE_CODE_MAX_RETRIES = '2'
    const endpoint = serve([brokenReply('api_error'), brokenReply('api_error'), overloaded])

    const { assistants } = await ask()

    expect(endpoint.requests()).toBe(3)
    expect(assistants.at(-1)!.isApiErrorMessage).toBe(true)
  })
})
