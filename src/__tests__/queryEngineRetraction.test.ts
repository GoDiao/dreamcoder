import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { APIError } from '@anthropic-ai/sdk'
import { QueryEngine } from '../QueryEngine.js'
import * as claudeApi from '../services/api/claude.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache.js'
import { createAssistantMessage, createSystemAPIErrorMessage } from '../utils/messages.js'
import { flushSessionStorage, getTranscriptPath } from '../utils/sessionStorage.js'

function reply(content: Parameters<typeof createAssistantMessage>[0]['content']) {
  const message = createAssistantMessage({ content })
  message.message.model = 'claude-sonnet-4-5'
  return message
}

describe('QueryEngine when a stream is retried', () => {
  let modelSpy: ReturnType<typeof spyOn> | undefined
  const envKeys = ['ANTHROPIC_API_KEY', 'TEST_ENABLE_SESSION_PERSISTENCE'] as const
  let savedEnv: Partial<Record<(typeof envKeys)[number], string>>

  beforeEach(() => {
    savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
  })

  afterEach(() => {
    modelSpy?.mockRestore()
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  test('keeps the whole retried reply, drops the partial one and tells the client', async () => {
    const partial = reply('Half an ans')
    const text = reply('Let me check.')
    const toolUse = reply([{ type: 'tool_use', id: 'toolu_1', name: 'Missing', input: {} }] as never)
    const final = reply('Done.')
    let calls = 0
    modelSpy = spyOn(claudeApi, 'queryModelWithStreaming').mockImplementation(async function* ({ options }) {
      calls += 1
      if (calls > 1) {
        yield final
        return
      }
      yield partial
      options.onStreamingFallback?.()
      yield {
        ...createSystemAPIErrorMessage(APIError.generate(undefined, undefined, 'the stream broke', undefined), 500, 1, 10),
        streamRestart: true,
      }
      yield { type: 'stream_event', event: { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } } }
      yield text
      yield toolUse
      yield { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } } }
    } as never)

    let appState = getDefaultAppState()
    const engine = new QueryEngine({
      cwd: process.cwd(),
      tools: [],
      commands: [],
      mcpClients: [],
      agents: [],
      canUseTool: async () => ({ behavior: 'allow' }) as never,
      getAppState: () => appState,
      setAppState: (update) => {
        appState = update(appState)
      },
      readFileCache: createFileStateCacheWithSizeLimit(10),
      userSpecifiedModel: 'claude-sonnet-4-5',
    })

    const output: Array<Record<string, unknown>> = []
    for await (const message of engine.submitMessage('hello')) output.push(message as Record<string, unknown>)
    await flushSessionStorage()

    const retracted = output.findIndex((m) => m.type === 'system' && m.subtype === 'stream_retracted')
    const retry = output.findIndex((m) => m.type === 'system' && m.subtype === 'api_retry')
    expect(retracted).toBeGreaterThan(-1)
    expect(retracted).toBeLessThan(retry)
    const history = engine.getMessages().map((m) => m.uuid)
    expect(history).not.toContain(partial.uuid)
    expect(history).toEqual(expect.arrayContaining([text.uuid, toolUse.uuid, final.uuid]))
    expect(calls).toBe(2)
    const transcript = await readFile(getTranscriptPath(), 'utf8')
    expect(transcript).not.toContain(partial.uuid)
    expect(transcript).toContain(toolUse.uuid)
    expect(transcript).toContain(final.uuid)
  })
})
