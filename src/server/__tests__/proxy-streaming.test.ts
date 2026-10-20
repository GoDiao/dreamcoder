import { describe, test, expect } from 'bun:test'
import { openaiChatStreamToAnthropic } from '../proxy/streaming/openaiChatStreamToAnthropic.js'
import { openaiResponsesStreamToAnthropic } from '../proxy/streaming/openaiResponsesStreamToAnthropic.js'
import { openaiResponsesStreamToAnthropicResponse } from '../proxy/streaming/openaiResponsesStreamToAnthropicResponse.js'

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

async function collectSse(stream: ReadableStream<Uint8Array>): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }

  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const blocks = text.split('\n\n').filter(Boolean)
  for (const block of blocks) {
    const lines = block.split('\n')
    let event = ''
    let data = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7)
      if (line.startsWith('data: ')) data = line.slice(6)
    }
    if (event && data) {
      try {
        events.push({ event, data: JSON.parse(data) })
      } catch {
      }
    }
  }
  return events
}

describe('openaiChatStreamToAnthropic', () => {
  test('basic text streaming', async () => {
    const sseChunks = [
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const anthropicStream = openaiChatStreamToAnthropic(upstream, 'gpt-4')
    const events = await collectSse(anthropicStream)

    const eventTypes = events.map((e) => e.event)
    expect(eventTypes[0]).toBe('message_start')
    expect(eventTypes).toContain('content_block_start')
    expect(eventTypes).toContain('content_block_delta')
    expect(eventTypes).toContain('message_delta')
    expect(eventTypes).toContain('message_stop')

    const msgStart = events.find((e) => e.event === 'message_start')!
    expect((msgStart.data.message as Record<string, unknown>).model).toBe('gpt-4')
    expect((msgStart.data.message as Record<string, unknown>).role).toBe('assistant')

    const textDeltas = events.filter((e) => e.event === 'content_block_delta')
    const texts = textDeltas.map((e) => (e.data.delta as Record<string, unknown>).text)
    expect(texts).toContain('Hello')
    expect(texts).toContain(' world')

    const msgDelta = events.find((e) => e.event === 'message_delta')!
    expect((msgDelta.data.delta as Record<string, unknown>).stop_reason).toBe('end_turn')
  })

  test('tool call streaming', async () => {
    const sseChunks = [
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":null},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"NYC\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const anthropicStream = openaiChatStreamToAnthropic(upstream, 'gpt-4')
    const events = await collectSse(anthropicStream)

    const toolStart = events.find(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'tool_use',
    )
    expect(toolStart).toBeDefined()
    expect((toolStart!.data.content_block as Record<string, unknown>).name).toBe('get_weather')
    expect((toolStart!.data.content_block as Record<string, unknown>).id).toBe('call_1')

    const jsonDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'input_json_delta',
    )
    expect(jsonDeltas.length).toBeGreaterThan(0)

    const msgDelta = events.find((e) => e.event === 'message_delta')!
    expect((msgDelta.data.delta as Record<string, unknown>).stop_reason).toBe('tool_use')
  })

  test('tool call finished with stop (Gemini) ends with tool_use', async () => {
    const sseChunks = [
      'data: {"id":"c3","object":"chat.completion.chunk","created":0,"model":"gemini","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"NYC\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c3","object":"chat.completion.chunk","created":0,"model":"gemini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiChatStreamToAnthropic(makeStream(sseChunks), 'gemini'))

    const msgDelta = events.find((e) => e.event === 'message_delta')!
    expect((msgDelta.data.delta as Record<string, unknown>).stop_reason).toBe('tool_use')
  })

  test('parallel tool calls without an index stay separate tool_use blocks', async () => {
    const sseChunks = [
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"gemini","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"id":"call_paris","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Paris\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"gemini","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_london","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"London\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"gemini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiChatStreamToAnthropic(makeStream(sseChunks), 'gemini'))

    const toolStarts = events.filter(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'tool_use',
    )
    expect(toolStarts.map((e) => (e.data.content_block as Record<string, unknown>).id)).toEqual(['call_paris', 'call_london'])

    const args = events
      .filter((e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'input_json_delta')
      .map((e) => (e.data.delta as Record<string, unknown>).partial_json)
    expect(args).toEqual(['{"city":"Paris"}', '{"city":"London"}'])
  })

  test('argument fragments without an index continue the latest tool call', async () => {
    const sseChunks = [
      'data: {"id":"c5","object":"chat.completion.chunk","created":0,"model":"gemini","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c5","object":"chat.completion.chunk","created":0,"model":"gemini","choices":[{"index":0,"delta":{"tool_calls":[{"function":{"arguments":"{\\"city\\""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c5","object":"chat.completion.chunk","created":0,"model":"gemini","choices":[{"index":0,"delta":{"tool_calls":[{"function":{"arguments":":\\"NYC\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c5","object":"chat.completion.chunk","created":0,"model":"gemini","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiChatStreamToAnthropic(makeStream(sseChunks), 'gemini'))

    const toolStarts = events.filter(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'tool_use',
    )
    expect(toolStarts).toHaveLength(1)
    const args = events
      .filter((e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'input_json_delta')
      .map((e) => (e.data.delta as Record<string, unknown>).partial_json)
    expect(args.join('')).toBe('{"city":"NYC"}')
  })

  test('tool call streaming preserves object arguments from local proxies', async () => {
    const sseChunks = [
      'data: {"id":"c-write","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_write","type":"function","function":{"name":"Write","arguments":{"file_path":"/tmp/issue-288.txt","content":"ok"}}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c-write","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiChatStreamToAnthropic(makeStream(sseChunks), 'gpt-4'))
    const jsonDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'input_json_delta',
    )
    expect(jsonDeltas).toHaveLength(1)
    expect((jsonDeltas[0].data.delta as Record<string, unknown>).partial_json).toBe(
      '{"file_path":"/tmp/issue-288.txt","content":"ok"}',
    )

    const blockStops = events.filter((e) => e.event === 'content_block_stop')
    expect(blockStops).toHaveLength(1)
    expect(blockStops[0].data.index).toBe(0)
  })

  test('empty stream (just DONE) surfaces an error instead of an empty reply', async () => {
    const upstream = makeStream(['data: [DONE]\n\n'])
    const anthropicStream = openaiChatStreamToAnthropic(upstream, 'gpt-4')
    const events = await collectSse(anthropicStream)
    expect(events.map((e) => e.event)).toEqual(['error'])
  })

  test('upstream error chunk mid-stream becomes an Anthropic error event', async () => {
    const upstream = makeStream([
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"error":{"message":"quota exceeded"}}\n\n',
      'data: [DONE]\n\n',
    ])
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'gpt-4'))
    const types = events.map((e) => e.event)
    expect(types.at(-1)).toBe('error')
    expect(types).not.toContain('message_stop')
    expect((events.at(-1)!.data as { error: { message: string } }).error.message).toBe('quota exceeded')
  })

  test('event ordering: content_block_stop before message_delta', async () => {
    const sseChunks = [
      'data: {"id":"c3","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"c3","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"id":"c3","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'gpt-4'))
    const types = events.map((e) => e.event)

    const stopIdx = types.indexOf('content_block_stop')
    const deltaIdx = types.indexOf('message_delta')
    expect(stopIdx).toBeGreaterThan(-1)
    expect(deltaIdx).toBeGreaterThan(-1)
    expect(stopIdx).toBeLessThan(deltaIdx)

    const msgStopIdx = types.indexOf('message_stop')
    expect(deltaIdx).toBeLessThan(msgStopIdx)
  })

  test('reasoning_content (DeepSeek, OpenRouter, XAI)', async () => {
    const sseChunks = [
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning_content":"Let me think"},"finish_reason":null}]}\n\n',
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"reasoning_content":" about this..."},"finish_reason":null}]}\n\n',
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"Hello!"},"finish_reason":null}]}\n\n',
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'deepseek-chat'))

    const thinkingStart = events.find(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'thinking',
    )
    expect(thinkingStart).toBeDefined()

    const thinkingDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'thinking_delta',
    )
    expect(thinkingDeltas.length).toBeGreaterThan(0)

    const textStart = events.find(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'text',
    )
    expect(textStart).toBeDefined()

    expect((textStart!.data as Record<string, unknown>).index).toBeGreaterThan(
      (thinkingStart!.data as Record<string, unknown>).index as number,
    )
  })

  test('reasoning field (GLM-5, Cerebras, Groq)', async () => {
    const sseChunks = [
      'data: {"id":"c5","object":"chat.completion.chunk","created":0,"model":"glm-5","choices":[{"index":0,"delta":{"role":"assistant","reasoning":"Thinking here"},"finish_reason":null}]}\n\n',
      'data: {"id":"c5","object":"chat.completion.chunk","created":0,"model":"glm-5","choices":[{"index":0,"delta":{"content":"Result"},"finish_reason":null}]}\n\n',
      'data: {"id":"c5","object":"chat.completion.chunk","created":0,"model":"glm-5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'glm-5'))

    const thinkingDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'thinking_delta',
    )
    expect(thinkingDeltas.length).toBe(1)
    expect((thinkingDeltas[0].data.delta as Record<string, unknown>).thinking).toBe('Thinking here')
  })

  test('thinking_blocks (OpenAI o-series)', async () => {
    const sseChunks = [
      'data: {"id":"c6","object":"chat.completion.chunk","created":0,"model":"o3","choices":[{"index":0,"delta":{"role":"assistant","thinking_blocks":[{"type":"thinking","thinking":"Deep thought"}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c6","object":"chat.completion.chunk","created":0,"model":"o3","choices":[{"index":0,"delta":{"content":"Answer"},"finish_reason":null}]}\n\n',
      'data: {"id":"c6","object":"chat.completion.chunk","created":0,"model":"o3","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'o3'))

    const thinkingDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'thinking_delta',
    )
    expect(thinkingDeltas.length).toBe(1)
    expect((thinkingDeltas[0].data.delta as Record<string, unknown>).thinking).toBe('Deep thought')
  })

  test('text + tool transition closes text block first', async () => {
    const sseChunks = [
      'data: {"id":"c7","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Let me search"},"finish_reason":null}]}\n\n',
      'data: {"id":"c7","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_x","type":"function","function":{"name":"search","arguments":"{\\"q\\":\\"test\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c7","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'gpt-4'))
    const types = events.map((e) => e.event)

    const firstBlockStop = types.indexOf('content_block_stop')
    const toolBlockStart = types.findIndex(
      (_, i) => events[i].event === 'content_block_start' && (events[i].data.content_block as Record<string, unknown>)?.type === 'tool_use',
    )
    expect(firstBlockStop).toBeLessThan(toolBlockStart)
  })

  test('message_delta usage includes input_tokens + cached tokens from final chunk', async () => {
    const sseChunks = [
      'data: {"id":"c-usage","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"id":"c-usage","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1234,"completion_tokens":42,"total_tokens":1276,"prompt_tokens_details":{"cached_tokens":900}}}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiChatStreamToAnthropic(makeStream(sseChunks), 'deepseek-chat'))
    const msgDelta = events.find((e) => e.event === 'message_delta')!
    // prompt_tokens includes the cached 900; Anthropic's input_tokens does not.
    expect(msgDelta.data.usage).toEqual({
      input_tokens: 334,
      output_tokens: 42,
      cache_read_input_tokens: 900,
    })
  })

  test('held message_delta merges usage from separate chunk', async () => {
    const sseChunks = [
      'data: {"id":"c-split","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"id":"c-split","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"id":"c-split","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[],"usage":{"prompt_tokens":500,"completion_tokens":10,"total_tokens":510}}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiChatStreamToAnthropic(makeStream(sseChunks), 'gpt-4'))
    const msgDelta = events.find((e) => e.event === 'message_delta')!
    expect((msgDelta.data.usage as Record<string, number>).input_tokens).toBe(500)
    expect((msgDelta.data.usage as Record<string, number>).output_tokens).toBe(10)
  })
})

describe('openaiResponsesStreamToAnthropic', () => {
  test('basic text streaming', async () => {
    const sseChunks = [
      'event: response.created\ndata: {"id":"r1","model":"gpt-4o","status":"in_progress"}\n\n',
      'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"message","role":"assistant"}}\n\n',
      'event: response.content_part.added\ndata: {"output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}\n\n',
      'event: response.output_text.delta\ndata: {"output_index":0,"content_index":0,"delta":"Hello"}\n\n',
      'event: response.output_text.delta\ndata: {"output_index":0,"content_index":0,"delta":" world"}\n\n',
      'event: response.output_text.done\ndata: {"output_index":0,"content_index":0,"text":"Hello world"}\n\n',
      'event: response.completed\ndata: {"response":{"id":"r1","model":"gpt-4o","status":"completed","usage":{"input_tokens":10,"output_tokens":5}}}\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const anthropicStream = openaiResponsesStreamToAnthropic(upstream, 'gpt-4o')
    const events = await collectSse(anthropicStream)

    const eventTypes = events.map((e) => e.event)
    expect(eventTypes[0]).toBe('message_start')
    expect(eventTypes).toContain('content_block_start')
    expect(eventTypes).toContain('content_block_delta')
    expect(eventTypes).toContain('content_block_stop')
    expect(eventTypes).toContain('message_delta')
    expect(eventTypes).toContain('message_stop')

    const textDeltas = events.filter((e) => e.event === 'content_block_delta')
    const texts = textDeltas.map((e) => (e.data.delta as Record<string, unknown>).text)
    expect(texts).toContain('Hello')
    expect(texts).toContain(' world')

    const msgDelta = events.find((e) => e.event === 'message_delta')!
    expect(msgDelta.data.usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
    })
  })

  test('function call streaming', async () => {
    const sseChunks = [
      'event: response.created\ndata: {"id":"r2","model":"gpt-4o","status":"in_progress"}\n\n',
      'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"search"}}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"item_id":"fc_1","delta":"{\\"q\\":"}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"item_id":"fc_1","delta":"\\"test\\"}"}\n\n',
      'event: response.function_call_arguments.done\ndata: {"item_id":"fc_1","arguments":"{\\"q\\":\\"test\\"}"}\n\n',
      'event: response.completed\ndata: {"response":{"id":"r2","model":"gpt-4o","status":"completed","usage":{"input_tokens":10,"output_tokens":5}}}\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const anthropicStream = openaiResponsesStreamToAnthropic(upstream, 'gpt-4o')
    const events = await collectSse(anthropicStream)

    const toolStart = events.find(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'tool_use',
    )
    expect(toolStart).toBeDefined()
    expect((toolStart!.data.content_block as Record<string, unknown>).name).toBe('search')

    const jsonDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'input_json_delta',
    )
    expect(jsonDeltas.length).toBeGreaterThan(0)

    const msgDelta = events.find((e) => e.event === 'message_delta')!
    expect((msgDelta.data.delta as Record<string, unknown>).stop_reason).toBe('tool_use')
  })

  test('response.failed becomes an Anthropic error event with the upstream message', async () => {
    const upstream = makeStream([
      'event: response.created\ndata: {"type":"response.created","response":{"id":"r1","model":"gpt-4o"}}\n\n',
      'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed","error":{"code":"insufficient_quota","message":"quota exceeded"}}}\n\n',
    ])
    const events = await collectSse(openaiResponsesStreamToAnthropic(upstream, 'gpt-4o'))
    const last = events.at(-1)!
    expect(last.event).toBe('error')
    expect((last.data.error as Record<string, unknown>).message).toBe('quota exceeded')
    expect(events.map((e) => e.event)).not.toContain('message_stop')
  })

  test('stream-level error events without an event line become Anthropic error events', async () => {
    const upstream = makeStream([
      'data: {"type":"error","code":"rate_limit_exceeded","message":"slow down"}\n\n',
    ])
    const events = await collectSse(openaiResponsesStreamToAnthropic(upstream, 'gpt-4o'))
    expect(events.map((e) => e.event)).toEqual(['error'])
    expect((events[0].data.error as Record<string, unknown>).message).toBe('slow down')
  })

  test('response.incomplete finishes the message with max_tokens', async () => {
    const upstream = makeStream([
      'event: response.created\ndata: {"type":"response.created","response":{"id":"r1","model":"o4-mini"}}\n\n',
      'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":5,"output_tokens":16}}}\n\n',
    ])
    const events = await collectSse(openaiResponsesStreamToAnthropic(upstream, 'o4-mini'))
    const delta = events.find((e) => e.event === 'message_delta')!
    expect((delta.data.delta as Record<string, unknown>).stop_reason).toBe('max_tokens')
    expect(events.at(-1)!.event).toBe('message_stop')
  })

  test('data-only events with reasoning_text parts (OpenRouter shape)', async () => {
    const sseChunks = [
      'data: {"type":"response.created","response":{"id":"r-or","model":"gpt-oss-20b","status":"in_progress"}}\n\n',
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"rs_empty"}}\n\n',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"rs_empty"}}\n\n',
      'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"reasoning","id":"rs_1"}}\n\n',
      'data: {"type":"response.content_part.added","output_index":1,"item_id":"rs_1","content_index":0,"part":{"type":"reasoning_text","text":""}}\n\n',
      'data: {"type":"response.reasoning_text.delta","output_index":1,"item_id":"rs_1","content_index":0,"delta":"Compute 17*23."}\n\n',
      'data: {"type":"response.reasoning_text.done","output_index":1,"item_id":"rs_1","content_index":0,"text":"Compute 17*23."}\n\n',
      'data: {"type":"response.output_item.added","output_index":2,"item":{"type":"message","id":"msg_1","role":"assistant"}}\n\n',
      'data: {"type":"response.content_part.added","output_index":2,"item_id":"msg_1","content_index":0,"part":{"type":"output_text","text":""}}\n\n',
      'data: {"type":"response.output_text.delta","output_index":2,"item_id":"msg_1","content_index":0,"delta":"391"}\n\n',
      'data: {"type":"response.output_text.done","output_index":2,"item_id":"msg_1","content_index":0,"text":"391"}\n\n',
      'data: {"type":"response.completed","response":{"id":"r-or","model":"gpt-oss-20b","status":"completed","usage":{"input_tokens":81,"output_tokens":20}}}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiResponsesStreamToAnthropic(makeStream(sseChunks), 'gpt-oss-20b'))

    const blocks = events
      .filter((e) => e.event === 'content_block_start' || e.event === 'content_block_stop')
      .map((e) => e.event === 'content_block_start'
        ? `start:${e.data.index}:${(e.data.content_block as Record<string, unknown>).type}`
        : `stop:${e.data.index}`)
    expect(blocks).toEqual(['start:0:thinking', 'stop:0', 'start:1:text', 'stop:1'])

    const deltas = events
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => e.data.delta as Record<string, unknown>)
    expect(deltas).toEqual([
      { type: 'thinking_delta', thinking: 'Compute 17*23.' },
      { type: 'text_delta', text: '391' },
    ])
  })

  test('reasoning summary streaming produces thinking block', async () => {
    const sseChunks = [
      'event: response.created\ndata: {"id":"r-reason","model":"o3","status":"in_progress"}\n\n',
      'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"reasoning","id":"rsn_1"}}\n\n',
      'event: response.reasoning_summary_text.delta\ndata: {"item_id":"rsn_1","delta":"Step 1: "}\n\n',
      'event: response.reasoning_summary_text.delta\ndata: {"item_id":"rsn_1","delta":"analyze"}\n\n',
      'event: response.reasoning_summary_text.done\ndata: {"item_id":"rsn_1","text":"Step 1: analyze"}\n\n',
      'event: response.reasoning_summary_part.done\ndata: {"item_id":"rsn_1","part":{"type":"summary_text","text":"Step 1: analyze"}}\n\n',
      'event: response.output_item.added\ndata: {"output_index":1,"item":{"type":"message","role":"assistant"}}\n\n',
      'event: response.content_part.added\ndata: {"output_index":1,"content_index":0,"part":{"type":"output_text","text":""}}\n\n',
      'event: response.output_text.delta\ndata: {"output_index":1,"content_index":0,"delta":"Answer"}\n\n',
      'event: response.output_text.done\ndata: {"output_index":1,"content_index":0,"text":"Answer"}\n\n',
      'event: response.completed\ndata: {"response":{"id":"r-reason","model":"o3","status":"completed","usage":{"input_tokens":50,"output_tokens":20}}}\n\n',
    ]

    const events = await collectSse(openaiResponsesStreamToAnthropic(makeStream(sseChunks), 'o3'))

    const thinkingStart = events.find(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'thinking',
    )
    expect(thinkingStart).toBeDefined()

    const thinkingDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'thinking_delta',
    )
    expect(thinkingDeltas.length).toBe(2)
    const thinkingText = thinkingDeltas.map((e) => (e.data.delta as Record<string, unknown>).thinking).join('')
    expect(thinkingText).toBe('Step 1: analyze')

    const types = events.map((e) => e.event)
    const lastBlockStopIdx = types.lastIndexOf('content_block_stop')
    const msgDeltaIdx = types.indexOf('message_delta')
    expect(lastBlockStopIdx).toBeLessThan(msgDeltaIdx)

    const startIdx = events.filter((e) => e.event === 'content_block_start').map((e) => e.data.index)
    const stopIdx = events.filter((e) => e.event === 'content_block_stop').map((e) => e.data.index)
    expect([...stopIdx].sort()).toEqual([...startIdx].sort())
  })

  test('cached tokens surfaced in message_delta usage', async () => {
    const sseChunks = [
      'event: response.created\ndata: {"id":"r-cache","model":"gpt-4o","status":"in_progress"}\n\n',
      'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"message","role":"assistant"}}\n\n',
      'event: response.content_part.added\ndata: {"output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}\n\n',
      'event: response.output_text.delta\ndata: {"output_index":0,"content_index":0,"delta":"Hi"}\n\n',
      'event: response.output_text.done\ndata: {"output_index":0,"content_index":0,"text":"Hi"}\n\n',
      'event: response.completed\ndata: {"response":{"id":"r-cache","model":"gpt-4o","status":"completed","usage":{"input_tokens":100,"output_tokens":5,"total_tokens":105,"input_tokens_details":{"cached_tokens":80}}}}\n\n',
    ]

    const events = await collectSse(openaiResponsesStreamToAnthropic(makeStream(sseChunks), 'gpt-4o'))
    const msgDelta = events.find((e) => e.event === 'message_delta')!
    // input_tokens includes the cached 80; Anthropic's input_tokens does not.
    expect(msgDelta.data.usage).toEqual({
      input_tokens: 20,
      output_tokens: 5,
      cache_read_input_tokens: 80,
    })
  })
})

describe('openaiResponsesStreamToAnthropicResponse', () => {
  const output = [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'partial' }] },
    { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{"path":"a"}' },
  ]

  test.each([
    ['response.completed', 'completed', 'tool_use'],
    ['response.incomplete', 'incomplete', 'max_tokens'],
  ])('keeps the final response of a %s event', async (event, status, stopReason) => {
    const response = {
      id: 'resp_1',
      model: 'gpt-5.6-terra',
      status,
      output,
      usage: { input_tokens: 12, output_tokens: 7 },
    }
    const result = await openaiResponsesStreamToAnthropicResponse(
      makeStream([`event: ${event}\ndata: ${JSON.stringify({ type: event, response })}\n\n`]),
      'm',
    )

    expect(result.stop_reason).toBe(stopReason)
    expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 7 })
    expect(result.content.map(block => block.type)).toEqual(['text', 'tool_use'])
  })
})

describe('stream cancellation', () => {
  test.each([
    ['openaiChatStreamToAnthropic', openaiChatStreamToAnthropic, 'data: {"id":"c","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"x"},"finish_reason":null}]}\n\n'],
    ['openaiResponsesStreamToAnthropic', openaiResponsesStreamToAnthropic, 'event: response.created\ndata: {"type":"response.created","response":{"id":"r1","model":"m"}}\n\n'],
  ] as const)('%s cancels the upstream body when the client cancels', async (_name, convert, firstChunk) => {
    let upstreamCancelReason: unknown = 'not cancelled'
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(firstChunk))
      },
      cancel(reason) {
        upstreamCancelReason = reason
      },
    })

    const reader = convert(upstream, 'm').getReader()
    await reader.read()
    await reader.cancel('client gone')

    expect(upstreamCancelReason).toBe('client gone')
  })
})
