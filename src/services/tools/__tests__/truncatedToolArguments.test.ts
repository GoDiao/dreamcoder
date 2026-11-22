import { describe, expect, test } from 'bun:test'
import { openaiChatToAnthropic } from '../../../server/proxy/transform/openaiChatToAnthropic.js'
import { parseOpenAIToolArguments } from '../../../server/proxy/transform/toolArguments.js'
import { resolveFallbackModelRules } from '../../../server/services/modelRules/resolveModelRules.js'
import type { OpenAIChatResponse } from '../../../server/proxy/transform/types.js'
import type { Tool, ToolUseContext, Tools } from '../../../Tool.js'
import type { AssistantMessage } from '../../../types/message.js'
import { createAssistantMessage, normalizeContentFromAPI } from '../../../utils/messages.js'
import { runToolUse } from '../toolExecution.js'

const truncated = '{"file_path":"/tmp/a.ts","content":"export const a = 1\\nexport const b'

function writeTool(calls: unknown[]): Tool {
  return {
    name: 'Write',
    call: async (input: unknown) => {
      calls.push(input)
      return { data: 'written' }
    },
  } as unknown as Tool
}

function normalizedInput(input: unknown, tools: Tools): unknown {
  const [block] = normalizeContentFromAPI(
    [{ type: 'tool_use', id: 'toolu_1', name: 'Write', input } as never],
    tools,
  )
  return (block as { input: unknown }).input
}

async function run(input: unknown, tools: Tools) {
  const assistant = createAssistantMessage({
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'Write', input } as never],
  }) as AssistantMessage
  const context = {
    options: { tools, mcpClients: [] },
    abortController: new AbortController(),
  } as unknown as ToolUseContext
  const updates = []
  for await (const update of runToolUse(
    { type: 'tool_use', id: 'toolu_1', name: 'Write', input } as never,
    assistant,
    async () => ({ behavior: 'allow' }) as never,
    context,
  )) {
    updates.push(update)
  }
  return updates
}

describe('truncated tool arguments', () => {
  test('the non-streaming proxy passes unparseable arguments on as the raw string', () => {
    const response = {
      id: 'c1',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-chat',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Write', arguments: truncated } }] },
        finish_reason: 'length',
      }],
    } as OpenAIChatResponse

    const block = openaiChatToAnthropic(
      response,
      'deepseek-chat',
      resolveFallbackModelRules({ baseUrl: 'https://api.deepseek.com', apiFormat: 'openai_chat' }),
    ).content[0]

    expect(block).toMatchObject({ type: 'tool_use', input: truncated })
  })

  test.each([
    ['a streamed tool call cut off by the output limit', truncated],
    ['arguments that are JSON but not an object', '["a.ts"]'],
  ])('marks %s instead of turning it into an empty object', (_kind, input) => {
    const marked = normalizedInput(input, [writeTool([])])

    expect(marked).toEqual({
      __dreamcoder_invalid_arguments: { receivedChars: input.length, parseError: expect.any(String) },
    })
  })

  test.each(['', '   ', 'null'])('still treats the argument string %p as no arguments', (input) => {
    expect(normalizedInput(input, [writeTool([])])).toEqual({})
  })

  test.each(['null', '  '])('the non-streaming proxy turns the argument string %p into no arguments', (args) => {
    expect(parseOpenAIToolArguments(args)).toEqual({})
  })

  test('does not run the tool and tells the model the arguments were cut off', async () => {
    const calls: unknown[] = []
    const tools = [writeTool(calls)]

    const updates = await run(normalizedInput(truncated, tools), tools)

    expect(calls).toHaveLength(0)
    expect(updates).toHaveLength(1)
    const update = updates[0]!.message
    if (update?.type !== 'user' || !Array.isArray(update.message.content)) throw new Error('expected a tool result message')
    const [result] = update.message.content
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true })
    const resultContent = result?.type === 'tool_result' ? result.content : undefined
    expect(String(resultContent)).toContain(`received ${truncated.length} characters`)
    expect(String(resultContent)).toContain('cut off by the output token limit')
  })
})
