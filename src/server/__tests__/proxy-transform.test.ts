import { describe, test, expect } from 'bun:test'
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js'
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js'
import type { AnthropicRequest, OpenAIChatResponse, OpenAIResponsesResponse } from '../proxy/transform/types.js'
import { resolveFallbackModelRules } from '../services/modelRules/resolveModelRules.js'

const CHAT_RULES = resolveFallbackModelRules({ baseUrl: 'https://llm.example.com/v1', apiFormat: 'openai_chat' })
const RESPONSES_RULES = resolveFallbackModelRules({ baseUrl: 'https://llm.example.com/v1', apiFormat: 'openai_responses' })

describe('anthropicToOpenaiChat', () => {
  test('basic text message', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    expect(result.model).toBe('gpt-4')
    expect(result.max_tokens).toBeUndefined()
    expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }])
  })

  test('streaming requests ask for token usage', () => {
    const base: AnthropicRequest = { model: 'gpt-4', max_tokens: 100, messages: [{ role: 'user', content: 'Hi' }] }
    expect(anthropicToOpenaiChat({ ...base, stream: true }, CHAT_RULES).stream_options).toEqual({ include_usage: true })
    expect(anthropicToOpenaiChat(base, CHAT_RULES).stream_options).toBeUndefined()
    expect(anthropicToOpenaiChat({ ...base, stream: false }, CHAT_RULES).stream_options).toBeUndefined()
  })

  test('system prompt string', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hi' }],
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful' })
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hi' })
  })

  test('system prompt array', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      system: [{ type: 'text', text: 'Part 1' }, { type: 'text', text: 'Part 2' }],
      messages: [{ role: 'user', content: 'Hi' }],
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    expect(result.messages[0]).toEqual({ role: 'system', content: 'Part 1\nPart 2' })
  })

  test('stop_sequences → stop', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      stop_sequences: ['END', 'STOP'],
      messages: [{ role: 'user', content: 'Hi' }],
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    expect(result.stop).toEqual(['END', 'STOP'])
  })

  test('tools conversion', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [{
        name: 'get_weather',
        description: 'Get weather',
        input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      }],
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    expect(result.tools).toHaveLength(1)
    expect(result.tools![0].type).toBe('function')
    expect(result.tools![0].function.name).toBe('get_weather')
    expect(result.tools![0].function.parameters).toEqual({ type: 'object', properties: { city: { type: 'string' } } })
  })

  test('filters BatchTool', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [
        { name: 'BatchTool', input_schema: {} },
        { name: 'real_tool', input_schema: {} },
      ],
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    expect(result.tools).toHaveLength(1)
    expect(result.tools![0].function.name).toBe('real_tool')
  })

  test('tool_choice conversion', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'any' },
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    expect(result.tool_choice).toBe('required')
  })

  test('tool_choice type=tool', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'tool', name: 'get_weather' },
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    expect(result.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } })
  })

  test('assistant message with tool_use', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check' },
          { type: 'tool_use', id: 'tc_1', name: 'get_weather', input: { city: 'NYC' } },
        ],
      }],
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    const msg = result.messages[0]
    expect(msg.role).toBe('assistant')
    expect(msg.content).toBe('Let me check')
    expect(msg.tool_calls).toHaveLength(1)
    expect(msg.tool_calls![0].id).toBe('tc_1')
    expect(msg.tool_calls![0].function.name).toBe('get_weather')
    expect(msg.tool_calls![0].function.arguments).toBe('{"city":"NYC"}')
  })

  test('user message with tool_result', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc_1', content: 'Sunny, 72°F' },
        ],
      }],
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    expect(result.messages[0].role).toBe('tool')
    expect(result.messages[0].tool_call_id).toBe('tc_1')
    expect(result.messages[0].content).toBe('Sunny, 72°F')
  })

  test('image content conversion', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      }],
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    const content = result.messages[0].content as Array<{ type: string; image_url?: { url: string } }>
    expect(content[0].type).toBe('image_url')
    expect(content[0].image_url!.url).toBe('data:image/png;base64,abc123')
  })

  test('tool_result images move to the next user message', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tc_img',
            content: [
              { type: 'text', text: 'Screenshot below:' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'deadbeef' } },
            ],
          },
        ],
      }],
    }
    const result = anthropicToOpenaiChat(req, CHAT_RULES)
    expect(result.messages[0].role).toBe('tool')
    expect(result.messages[0].tool_call_id).toBe('tc_img')
    expect(result.messages[0].content).toBe('Screenshot below:\n[Attachments from this result are in the next user message.]')
    expect(result.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '[Attachments from tool result tc_img]' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,deadbeef' } },
      ],
    })
  })

})

describe('openaiChatToAnthropic', () => {
  test('reads usage that the provider puts inside the choice (Moonshot)', () => {
    const res = {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 0,
      model: 'kimi-k2.6',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
        usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020 },
      }],
    } as unknown as OpenAIChatResponse

    expect(openaiChatToAnthropic(res, 'kimi-k2.6', CHAT_RULES).usage).toEqual({ input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 0 })
  })

  test('basic text response', () => {
    const res: OpenAIChatResponse = {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello!' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }
    const result = openaiChatToAnthropic(res, 'gpt-4', CHAT_RULES)
    expect(result.type).toBe('message')
    expect(result.role).toBe('assistant')
    expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }])
    expect(result.stop_reason).toBe('end_turn')
    expect(result.usage.input_tokens).toBe(10)
    expect(result.usage.output_tokens).toBe(5)
  })

  test('tool_calls response', () => {
    const res: OpenAIChatResponse = {
      id: 'chatcmpl-2',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }
    const result = openaiChatToAnthropic(res, 'gpt-4', CHAT_RULES)
    expect(result.stop_reason).toBe('tool_use')
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('tool_use')
    if (result.content[0].type === 'tool_use') {
      expect(result.content[0].id).toBe('call_1')
      expect(result.content[0].name).toBe('get_weather')
      expect(result.content[0].input).toEqual({ city: 'NYC' })
    }
  })

  test('tool_calls response preserves object arguments from local proxies', () => {
    const res: OpenAIChatResponse = {
      id: 'chatcmpl-write',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_write',
            type: 'function',
            function: {
              name: 'Write',
              arguments: { file_path: '/tmp/issue-288.txt', content: 'ok' },
            },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }

    const result = openaiChatToAnthropic(res, 'gpt-4', CHAT_RULES)
    expect(result.content[0].type).toBe('tool_use')
    if (result.content[0].type === 'tool_use') {
      expect(result.content[0].name).toBe('Write')
      expect(result.content[0].input).toEqual({
        file_path: '/tmp/issue-288.txt',
        content: 'ok',
      })
    }
  })

  test('tool_calls finished with stop (Gemini) still ends with tool_use', () => {
    const res = {
      id: 'x', object: 'chat.completion', created: 0, model: 'gemini',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"NYC"}' } }],
        },
        finish_reason: 'stop',
      }],
    } as OpenAIChatResponse

    expect(openaiChatToAnthropic(res, 'gemini', CHAT_RULES).stop_reason).toBe('tool_use')
  })

  test('finish_reason mapping', () => {
    const make = (reason: string) => ({
      id: 'x', object: 'chat.completion', created: 0, model: 'gpt-4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: reason }],
    } as OpenAIChatResponse)

    expect(openaiChatToAnthropic(make('stop'), 'gpt-4', CHAT_RULES).stop_reason).toBe('end_turn')
    expect(openaiChatToAnthropic(make('length'), 'gpt-4', CHAT_RULES).stop_reason).toBe('max_tokens')
    expect(openaiChatToAnthropic(make('tool_calls'), 'gpt-4', CHAT_RULES).stop_reason).toBe('tool_use')
    expect(openaiChatToAnthropic(make('model_context_window_exceeded'), 'gpt-4', CHAT_RULES).stop_reason).toBe('model_context_window_exceeded')
    expect(() => openaiChatToAnthropic(make('content_filter'), 'gpt-4', CHAT_RULES))
      .toThrow("The provider's content filter stopped the reply (finish_reason: content_filter).")
  })

  test('empty choices', () => {
    const res: OpenAIChatResponse = {
      id: 'x', object: 'chat.completion', created: 0, model: 'gpt-4',
      choices: [],
    }
    const result = openaiChatToAnthropic(res, 'gpt-4', CHAT_RULES)
    expect(result.content).toEqual([{ type: 'text', text: '' }])
    expect(result.stop_reason).toBe('end_turn')
  })

  test('cached tokens mapping', () => {
    const res: OpenAIChatResponse = {
      id: 'x', object: 'chat.completion', created: 0, model: 'gpt-4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 80 },
      },
    }
    const result = openaiChatToAnthropic(res, 'gpt-4', CHAT_RULES)
    expect(result.usage).toEqual({ input_tokens: 20, output_tokens: 50, cache_read_input_tokens: 80 })
  })

  test.each([
    ['DeepSeek prompt_cache_hit_tokens', { prompt_cache_hit_tokens: 80 }],
    ['Moonshot top-level cached_tokens', { cached_tokens: 80 }],
  ])('cached tokens mapping from %s', (_name, cacheFields) => {
    const res: OpenAIChatResponse = {
      id: 'x', object: 'chat.completion', created: 0, model: 'gpt-4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, ...cacheFields },
    }
    const result = openaiChatToAnthropic(res, 'gpt-4', CHAT_RULES)
    expect(result.usage).toEqual({ input_tokens: 20, output_tokens: 50, cache_read_input_tokens: 80 })
  })
})

describe('anthropicToOpenaiResponses', () => {
  test('basic message', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 1024,
      system: 'Be helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    expect(result.model).toBe('gpt-4o')
    expect(result.instructions).toBe('Be helpful')
    expect(result.store).toBe(false)
    expect(result.tools).toBeUndefined()
    expect(result.max_output_tokens).toBeUndefined()
    expect(result.input).toEqual([{ type: 'message', role: 'user', content: 'Hello' }])
  })

  test('tools conversion uses top-level name and turns strict mode off, so optional parameters stay optional', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [{
        name: 'get_weather',
        description: 'Get weather',
        input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      }],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    expect(result.tools).toHaveLength(1)
    expect(result.tools![0]).toEqual({
      type: 'function',
      name: 'get_weather',
      description: 'Get weather',
      parameters: { type: 'object', properties: { city: { type: 'string' } } },
      strict: false,
    })
  })

  test('tool_use lifted to function_call', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [{
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tc_1', name: 'search', input: { q: 'test' } },
        ],
      }],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    const fc = result.input.find((i) => i.type === 'function_call')
    expect(fc).toBeDefined()
    if (fc && fc.type === 'function_call') {
      expect(fc.call_id).toBe('tc_1')
      expect(fc.name).toBe('search')
      expect(fc.arguments).toBe('{"q":"test"}')
    }
  })

  test('text around tool_use is flushed as separate messages, in order', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'text', text: 'Searching.' },
          { type: 'tool_use', id: 'tc_1', name: 'search', input: { q: 'x' } },
          { type: 'text', text: 'Done.' },
        ],
      }],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    expect(result.input.map((i) => i.type)).toEqual(['message', 'function_call', 'message'])
    expect((result.input[0] as { content: unknown }).content).toEqual([
      { type: 'output_text', text: 'Let me check.' },
      { type: 'output_text', text: 'Searching.' },
    ])
    expect((result.input[2] as { content: unknown }).content).toBe('Done.')
  })

  test('tool_result lifted to function_call_output', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc_1', content: 'found it' },
        ],
      }],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    const fco = result.input.find((i) => i.type === 'function_call_output')
    expect(fco).toBeDefined()
    if (fco && fco.type === 'function_call_output') {
      expect(fco.call_id).toBe('tc_1')
      expect(fco.output).toBe('found it')
    }
  })

  test('stop_sequences dropped', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
      stop_sequences: ['END'],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    expect((result as Record<string, unknown>).stop).toBeUndefined()
    expect((result as Record<string, unknown>).stop_sequences).toBeUndefined()
  })

  test('image content uses input_image format (not Chat image_url)', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      }],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    const msg = result.input.find((i) => i.type === 'message')!
    expect(msg).toBeDefined()
    const content = msg.content as Array<{ type: string; image_url?: string }>
    expect(content[0].type).toBe('input_image')
    expect(content[0].image_url).toBe('data:image/png;base64,abc123')
  })

  test('text content uses input_text format in multi-part message', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      }],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    const msg = result.input.find((i) => i.type === 'message')!
    const content = msg.content as Array<{ type: string }>
    expect(content[0].type).toBe('input_text')
    expect(content[1].type).toBe('input_image')
  })

  test('assistant text uses output_text format in multi-part message', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [
        { role: 'user', content: 'Hi' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hello.' },
            { type: 'text', text: 'Anything else?' },
          ],
        },
      ],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    const msg = result.input.find((i) => i.type === 'message' && i.role === 'assistant')
    if (msg?.type !== 'message') throw new Error('missing assistant message')
    const content = msg.content as Array<{ type: string; text: string }>
    expect(content).toEqual([
      { type: 'output_text', text: 'Hello.' },
      { type: 'output_text', text: 'Anything else?' },
    ])
  })

  test('tool_choice type=tool uses the flat Responses function shape', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'tool', name: 'get_weather' },
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    expect(result.tool_choice).toEqual({ type: 'function', name: 'get_weather' })
  })

  test('tool_choice any, auto and none map to the Responses string values', () => {
    const choose = (tool_choice: AnthropicRequest['tool_choice']) =>
      anthropicToOpenaiResponses({
        model: 'gpt-4o',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Hi' }],
        tool_choice,
      }, RESPONSES_RULES).tool_choice
    expect(choose({ type: 'any' })).toBe('required')
    expect(choose({ type: 'auto' })).toBe('auto')
    expect(choose({ type: 'none' })).toBe('none')
  })

  test('single assistant text part is flattened to a string', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    const msg = result.input.find((i) => i.type === 'message')!
    expect(msg.content).toBe('Done.')
  })

  test('tool_result images stay in the function call output', () => {
    const req: AnthropicRequest = {
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tc_img',
            content: [
              { type: 'text', text: 'Screenshot:' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'ff' } },
            ],
          },
        ],
      }],
    }
    const result = anthropicToOpenaiResponses(req, RESPONSES_RULES)
    const fco = result.input.find((i) => i.type === 'function_call_output')!
    expect(fco).toBeDefined()
    expect(fco.output).toEqual([
      { type: 'input_text', text: 'Screenshot:' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,ff' },
    ])
  })

})

describe('openaiResponsesToAnthropic', () => {
  test.each([
    [{ reason: 'max_output_tokens' }, 'max_tokens'],
    [undefined, 'max_tokens'],
  ])('maps an incomplete reply with %o to %s', (details, stopReason) => {
    const res = { id: 'r1', object: 'response', created_at: 0, model: 'gpt-4.1', status: 'incomplete', incomplete_details: details, output: [] } as OpenAIResponsesResponse

    expect(openaiResponsesToAnthropic(res, 'gpt-4.1', RESPONSES_RULES).stop_reason).toBe(stopReason)
  })

  test('reports an incomplete reply stopped by the content filter as an error', () => {
    const res = { id: 'r1', object: 'response', created_at: 0, model: 'gpt-4.1', status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] } as OpenAIResponsesResponse

    expect(() => openaiResponsesToAnthropic(res, 'gpt-4.1', RESPONSES_RULES))
      .toThrow("The provider's content filter stopped the reply (incomplete: content_filter).")
  })

  test('basic text response', () => {
    const res: OpenAIResponsesResponse = {
      id: 'resp_1',
      object: 'response',
      created_at: 1234567890,
      model: 'gpt-4o',
      status: 'completed',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello!' }],
      }],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }
    const result = openaiResponsesToAnthropic(res, 'gpt-4o', RESPONSES_RULES)
    expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }])
    expect(result.stop_reason).toBe('end_turn')
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 })
  })

  test('cached tokens are taken out of input_tokens', () => {
    const res: OpenAIResponsesResponse = {
      id: 'resp_cache',
      object: 'response',
      created_at: 0,
      model: 'gpt-4o',
      status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105, input_tokens_details: { cached_tokens: 80 } },
    }
    const result = openaiResponsesToAnthropic(res, 'gpt-4o', RESPONSES_RULES)
    expect(result.usage).toEqual({ input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 80 })
  })

  test('function_call → tool_use', () => {
    const res: OpenAIResponsesResponse = {
      id: 'resp_2',
      object: 'response',
      created_at: 0,
      model: 'gpt-4o',
      status: 'completed',
      output: [{
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'search',
        arguments: '{"q":"test"}',
      }],
    }
    const result = openaiResponsesToAnthropic(res, 'gpt-4o', RESPONSES_RULES)
    expect(result.stop_reason).toBe('tool_use')
    expect(result.content[0].type).toBe('tool_use')
    if (result.content[0].type === 'tool_use') {
      expect(result.content[0].id).toBe('call_1')
      expect(result.content[0].input).toEqual({ q: 'test' })
    }
  })

  test('function_call preserves object arguments from local proxies', () => {
    const res: OpenAIResponsesResponse = {
      id: 'resp_write',
      object: 'response',
      created_at: 0,
      model: 'gpt-4o',
      status: 'completed',
      output: [{
        type: 'function_call',
        id: 'fc_write',
        call_id: 'call_write',
        name: 'Write',
        arguments: { file_path: '/tmp/issue-288.txt', content: 'ok' },
      }],
    }

    const result = openaiResponsesToAnthropic(res, 'gpt-4o', RESPONSES_RULES)
    expect(result.content[0].type).toBe('tool_use')
    if (result.content[0].type === 'tool_use') {
      expect(result.content[0].input).toEqual({
        file_path: '/tmp/issue-288.txt',
        content: 'ok',
      })
    }
  })

  test('reasoning → thinking', () => {
    const res: OpenAIResponsesResponse = {
      id: 'resp_3',
      object: 'response',
      created_at: 0,
      model: 'gpt-4o',
      status: 'completed',
      output: [
        { type: 'reasoning', id: 'r_1', summary: [{ type: 'text', text: 'Thinking...' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Result' }] },
      ],
    }
    const result = openaiResponsesToAnthropic(res, 'gpt-4o', RESPONSES_RULES)
    expect(result.content).toHaveLength(2)
    expect(result.content[0].type).toBe('thinking')
    if (result.content[0].type === 'thinking') {
      expect(result.content[0].thinking).toBe('Thinking...')
    }
    expect(result.content[1].type).toBe('text')
  })

  test('status incomplete → max_tokens', () => {
    const res: OpenAIResponsesResponse = {
      id: 'resp_4',
      object: 'response',
      created_at: 0,
      model: 'gpt-4o',
      status: 'incomplete',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'partial' }] }],
    }
    const result = openaiResponsesToAnthropic(res, 'gpt-4o', RESPONSES_RULES)
    expect(result.stop_reason).toBe('max_tokens')
  })

  test('empty output', () => {
    const res: OpenAIResponsesResponse = {
      id: 'resp_5',
      object: 'response',
      created_at: 0,
      model: 'gpt-4o',
      status: 'completed',
      output: [],
    }
    const result = openaiResponsesToAnthropic(res, 'gpt-4o', RESPONSES_RULES)
    expect(result.content).toEqual([{ type: 'text', text: '' }])
  })
})

describe('response model name', () => {
  test('chat responses report the requested model, not the snapshot the upstream returns', () => {
    const res: OpenAIChatResponse = {
      id: 'x', object: 'chat.completion', created: 0, model: 'gpt-4.1-2025-04-14',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    }
    expect(openaiChatToAnthropic(res, 'gpt-4.1', CHAT_RULES).model).toBe('gpt-4.1')
    expect(openaiChatToAnthropic({ ...res, choices: [] }, 'gpt-4.1', CHAT_RULES).model).toBe('gpt-4.1')
  })

  test('Responses API results report the requested model, not the snapshot the upstream returns', () => {
    const res: OpenAIResponsesResponse = {
      id: 'r', object: 'response', created_at: 0, model: 'gpt-4.1-2025-04-14', status: 'completed', output: [],
    }
    expect(openaiResponsesToAnthropic(res, 'gpt-4.1', RESPONSES_RULES).model).toBe('gpt-4.1')
  })
})

describe('tool request options', () => {
  const tool = { name: 'Read', description: 'Read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }
  const base: AnthropicRequest = { model: 'gpt-4', max_tokens: 100, messages: [{ role: 'user', content: 'Hi' }] }

  test.each([
    ['anthropicToOpenaiChat', (req: AnthropicRequest) => anthropicToOpenaiChat(req, CHAT_RULES) as { parallel_tool_calls?: boolean }],
    ['anthropicToOpenaiResponses', (req: AnthropicRequest) => anthropicToOpenaiResponses(req, RESPONSES_RULES) as { parallel_tool_calls?: boolean }],
  ] as const)('%s allows parallel tool calls only when tools are sent', (_name, convert) => {
    expect(convert({ ...base, tools: [tool] }).parallel_tool_calls).toBe(true)
    expect(convert(base).parallel_tool_calls).toBeUndefined()
  })
  test.each([
    ['anthropicToOpenaiChat', (req: AnthropicRequest) => anthropicToOpenaiChat(req, CHAT_RULES).tools![0]!.function.parameters],
    ['anthropicToOpenaiResponses', (req: AnthropicRequest) => anthropicToOpenaiResponses(req, RESPONSES_RULES).tools![0]!.parameters],
  ] as const)('%s drops the schema URL and the safe-integer bounds zod adds', (_name, parametersOf) => {
    const inputSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
        offset: { type: 'integer', minimum: 0, maximum: 9007199254740991 },
        items: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 } } } },
        url: { type: 'string', format: 'uri' },
        $schema: { type: 'string', description: 'a parameter that happens to be named $schema' },
      },
      required: ['limit'],
      additionalProperties: false,
    }

    expect(parametersOf({ ...base, tools: [{ name: 'T', input_schema: inputSchema }] })).toEqual({
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer', minimum: 0 },
        items: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer', exclusiveMinimum: 0 } } } },
        url: { type: 'string', format: 'uri' },
        $schema: { type: 'string', description: 'a parameter that happens to be named $schema' },
      },
      required: ['limit'],
      additionalProperties: false,
    })
  })
})
