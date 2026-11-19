import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import type { EffortLevel } from '../../utils/effort.js'
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js'
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js'
import { openaiChatStreamToAnthropic } from '../proxy/streaming/openaiChatStreamToAnthropic.js'
import { openaiResponsesStreamToAnthropic } from '../proxy/streaming/openaiResponsesStreamToAnthropic.js'
import type {
  AnthropicContentBlock,
  AnthropicRequest,
  OpenAIChatResponse,
  OpenAIResponsesResponse,
} from '../proxy/transform/types.js'
import { resolveModelRules, type ModelRulesProvider } from '../services/modelRules/resolveModelRules.js'
import { ProviderService } from '../services/providerService.js'
import { SettingsService } from '../services/settingsService.js'
import type { ResolvedModelRules } from '../types/modelRules.js'
import type { ApiFormat } from '../types/provider.js'
import { sendToUpstream } from '../upstream/client.js'

const THINKING_KEYS = ['thinking', 'reasoning', 'reasoning_effort', 'enable_thinking'] as const
const MAX_TOKEN_KEYS = ['max_tokens', 'max_completion_tokens', 'max_output_tokens'] as const

type Body = Record<string, unknown>

function rulesFor(
  baseUrl: string,
  apiFormat: ApiFormat,
  model: string,
  extra: Partial<ModelRulesProvider> = {},
): ResolvedModelRules {
  return resolveModelRules({ baseUrl, apiFormat, ...extra }, model)
}

function request(model: string, extra: Partial<AnthropicRequest> = {}): AnthropicRequest {
  return { model, max_tokens: 32_000, messages: [{ role: 'user', content: 'hi' }], ...extra }
}

const off: Partial<AnthropicRequest> = { thinking: { type: 'disabled' } }
const on: Partial<AnthropicRequest> = { thinking: { type: 'adaptive' } }
const level = (effort: EffortLevel): Partial<AnthropicRequest> => ({ thinking: { type: 'adaptive' }, output_config: { effort } })
const effortOnly = (effort: EffortLevel): Partial<AnthropicRequest> => ({ output_config: { effort } })

function chat(rules: ResolvedModelRules, model: string, extra: Partial<AnthropicRequest>, defaultEffort?: EffortLevel): Body {
  return anthropicToOpenaiChat(request(model, extra), rules, { defaultEffort }) as Body
}

function responses(rules: ResolvedModelRules, model: string, extra: Partial<AnthropicRequest>, defaultEffort?: EffortLevel): Body {
  return anthropicToOpenaiResponses(request(model, extra), rules, { defaultEffort }) as Body
}

function thinkingFields(body: Body): Body {
  return Object.fromEntries(THINKING_KEYS.filter(key => key in body).map(key => [key, body[key]]))
}

function maxTokenFields(body: Body): Body {
  return Object.fromEntries(MAX_TOKEN_KEYS.filter(key => key in body).map(key => [key, body[key]]))
}

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collectSse(stream: ReadableStream<Uint8Array>): Promise<Array<{ event: string; data: Body }>> {
  const text = await new Response(stream).text()
  return text.split('\n\n').filter(Boolean).flatMap(block => {
    const event = block.split('\n').find(line => line.startsWith('event: '))?.slice(7)
    const data = block.split('\n').find(line => line.startsWith('data: '))?.slice(6)
    return event && data ? [{ event, data: JSON.parse(data) as Body }] : []
  })
}

function chatChunk(delta: Body, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
}

function deltasOf(events: Array<{ event: string; data: Body }>): Body[] {
  return events.filter(e => e.event === 'content_block_delta').map(e => e.data.delta as Body)
}

function blockSequence(events: Array<{ event: string; data: Body }>): string[] {
  return events
    .filter(e => e.event.startsWith('content_block_'))
    .map(e => {
      if (e.event === 'content_block_start') return `start:${(e.data.content_block as Body).type}`
      if (e.event === 'content_block_stop') return 'stop'
      return (e.data.delta as Body).type as string
    })
}

function thinkingBlock(thinking: string, signature?: string): AnthropicContentBlock {
  return signature === undefined ? { type: 'thinking', thinking } : { type: 'thinking', thinking, signature }
}

function historyWith(thinking: AnthropicContentBlock[]): Partial<AnthropicRequest> {
  return {
    messages: [
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: [...thinking, { type: 'tool_use', id: 'call_1', name: 'Weather', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'sunny' }] },
    ],
  }
}

function assistantOf(body: Body): Body {
  return (body.messages as Body[]).find(message => message.role === 'assistant')!
}

describe('proxy reasoning dialects', () => {
  test('reasoning_effort: OpenAI chat writes reasoning_effort, none when off, nothing when unspecified', () => {
    const rules = rulesFor('https://api.openai.com/v1', 'openai_chat', 'gpt-5.1')
    expect(rules.reasoningDialect).toBe('reasoning_effort')
    expect(thinkingFields(chat(rules, 'gpt-5.1', off))).toEqual({ reasoning_effort: 'none' })
    expect(thinkingFields(chat(rules, 'gpt-5.1', level('high')))).toEqual({ reasoning_effort: 'high' })
    expect(thinkingFields(chat(rules, 'gpt-5.1', effortOnly('medium')))).toEqual({ reasoning_effort: 'medium' })
    expect(thinkingFields(chat(rules, 'gpt-5.1', on, 'low'))).toEqual({ reasoning_effort: 'low' })
    expect(thinkingFields(chat(rules, 'gpt-5.1', {}))).toEqual({})
  })

  test('reasoning_effort: an effort model never gets none and keeps a level when thinking is off', () => {
    const rules = rulesFor('https://api.openai.com/v1', 'openai_chat', 'gpt-5')
    expect(thinkingFields(chat(rules, 'gpt-5', off, 'medium'))).toEqual({ reasoning_effort: 'medium' })
    expect(thinkingFields(chat(rules, 'gpt-5', level('max')))).toEqual({ reasoning_effort: 'high' })
  })

  test('responses_reasoning: gpt-6-luna turns thinking off with none and gpt-6.1-sol never sends none', () => {
    const luna = rulesFor('https://gateway.example.com/v1', 'openai_responses', 'gpt-6-luna')
    expect(thinkingFields(responses(luna, 'gpt-6-luna', off))).toEqual({ reasoning: { effort: 'none' } })
    expect(thinkingFields(responses(luna, 'gpt-6-luna', level('max')))).toEqual({ reasoning: { effort: 'max' } })
    const sol = rulesFor('https://gateway.example.com/v1', 'openai_responses', 'gpt-6.1-sol')
    expect(thinkingFields(responses(sol, 'gpt-6.1-sol', off, 'medium'))).toEqual({ reasoning: { effort: 'medium' } })
    expect(thinkingFields(responses(sol, 'gpt-6.1-sol', level('max')))).toEqual({ reasoning: { effort: 'max' } })
  })

  test('responses_reasoning: Responses writes reasoning.effort and asks for encrypted reasoning', () => {
    const rules = rulesFor('https://api.openai.com/v1', 'openai_responses', 'gpt-5.1')
    expect(thinkingFields(responses(rules, 'gpt-5.1', off))).toEqual({ reasoning: { effort: 'none' } })
    expect(thinkingFields(responses(rules, 'gpt-5.1', level('max')))).toEqual({ reasoning: { effort: 'high' } })
    expect(thinkingFields(responses(rules, 'gpt-5.1', effortOnly('low')))).toEqual({ reasoning: { effort: 'low' } })
    expect(thinkingFields(responses(rules, 'gpt-5.1', on, 'medium'))).toEqual({ reasoning: { effort: 'medium' } })
    expect(thinkingFields(responses(rules, 'gpt-5.1', {}))).toEqual({})
    expect(responses(rules, 'gpt-5.1', level('low')).include).toEqual(['reasoning.encrypted_content'])

    const plain = rulesFor('https://api.openai.com/v1', 'openai_responses', 'gpt-4.1')
    expect(responses(plain, 'gpt-4.1', level('low')).include).toBeUndefined()
  })

  test('thinking_type: DeepSeek chat writes thinking.type and a converted reasoning_effort', () => {
    const rules = rulesFor('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro')
    expect(rules.reasoningDialect).toBe('thinking_type')
    expect(thinkingFields(chat(rules, 'deepseek-v4-pro', off))).toEqual({ thinking: { type: 'disabled' } })
    expect(thinkingFields(chat(rules, 'deepseek-v4-pro', level('medium')))).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    })
    expect(thinkingFields(chat(rules, 'deepseek-v4-pro', effortOnly('low')))).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    })
    expect(thinkingFields(chat(rules, 'deepseek-v4-pro', on, 'medium'))).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    })
    expect(thinkingFields(chat(rules, 'deepseek-v4-pro', {}))).toEqual({})
  })

  test('thinking_type: a model without levels gets enabled without effort, and the site extraBody merges into thinking', () => {
    const rules = rulesFor('https://api.moonshot.ai/v1', 'openai_chat', 'kimi-k2.6')
    expect(thinkingFields(chat(rules, 'kimi-k2.6', level('high')))).toEqual({ thinking: { type: 'enabled', keep: 'all' } })
    expect(thinkingFields(chat(rules, 'kimi-k2.6', on))).toEqual({ thinking: { type: 'enabled', keep: 'all' } })
    expect(thinkingFields(chat(rules, 'kimi-k2.6', off))).toEqual({ thinking: { type: 'disabled', keep: 'all' } })
    expect(thinkingFields(chat(rules, 'kimi-k2.6', {}))).toEqual({})
  })

  test('thinking_adaptive: MiniMax chat writes adaptive thinking and keeps reasoning_split', () => {
    const always = rulesFor('https://api.minimax.io/v1', 'openai_chat', 'MiniMax-M3.1-Flash')
    const offBody = chat(always, 'MiniMax-M3.1-Flash', off, 'medium')
    expect(thinkingFields(offBody)).toEqual({ thinking: { type: 'adaptive' }, reasoning_effort: 'medium' })
    expect(offBody.reasoning_split).toBe(true)
    expect(thinkingFields(chat(always, 'MiniMax-M3.1-Flash', level('low')))).toEqual({
      thinking: { type: 'adaptive' },
      reasoning_effort: 'low',
    })

    const toggle = rulesFor('https://api.minimax.io/v1', 'openai_chat', 'MiniMax-M3')
    expect(thinkingFields(chat(toggle, 'MiniMax-M3', on))).toEqual({ thinking: { type: 'adaptive' } })
    expect(thinkingFields(chat(toggle, 'MiniMax-M3', off))).toEqual({ thinking: { type: 'disabled' } })
    expect(chat(toggle, 'MiniMax-M3', {}).reasoning_split).toBe(true)
  })

  test('enable_thinking: Bailian writes enable_thinking and reasoning_effort only for models with levels', () => {
    const levels = rulesFor('https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai_chat', 'qwen4-max')
    expect(thinkingFields(chat(levels, 'qwen4-max', level('medium')))).toEqual({ enable_thinking: true, reasoning_effort: 'high' })
    expect(thinkingFields(chat(levels, 'qwen4-max', off))).toEqual({ enable_thinking: false })

    const toggle = rulesFor('https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai_chat', 'qwen3.5-plus')
    expect(thinkingFields(chat(toggle, 'qwen3.5-plus', on))).toEqual({ enable_thinking: true })
    expect(thinkingFields(chat(toggle, 'qwen3.5-plus', level('high')))).toEqual({ enable_thinking: true })
    expect(thinkingFields(chat(toggle, 'qwen3.5-plus', {}))).toEqual({})
  })

  test('openrouter: OpenRouter writes the reasoning object', () => {
    const rules = rulesFor('https://openrouter.ai/api/v1', 'openai_chat', 'deepseek/deepseek-v4-pro')
    expect(thinkingFields(chat(rules, 'deepseek/deepseek-v4-pro', level('max')))).toEqual({ reasoning: { effort: 'max' } })
    expect(thinkingFields(chat(rules, 'deepseek/deepseek-v4-pro', off))).toEqual({ reasoning: { effort: 'none' } })
    expect(thinkingFields(chat(rules, 'deepseek/deepseek-v4-pro', on, 'medium'))).toEqual({ reasoning: { effort: 'high' } })

    const toggle = rulesFor('https://openrouter.ai/api/v1', 'openai_chat', 'moonshotai/kimi-k2')
    expect(thinkingFields(chat(toggle, 'moonshotai/kimi-k2', on))).toEqual({ reasoning: { enabled: true } })
  })

  test('the global effort defaults to medium when the caller passes none', () => {
    const rules = rulesFor('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro')
    expect(chat(rules, 'deepseek-v4-pro', on).reasoning_effort).toBe('high')
  })
})

describe('extraBody', () => {
  test('merges deeply after the dialect fields, and extraBody wins on the same path', () => {
    const rules = rulesFor('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro', {
      modelOverrides: { 'deepseek-v4-pro': { extraBody: { thinking: { type: 'enabled', keep: 'all' }, top_k: 5 } } },
    })
    const body = chat(rules, 'deepseek-v4-pro', off)
    expect(body.thinking).toEqual({ type: 'enabled', keep: 'all' })
    expect(body.top_k).toBe(5)
  })

  test('keeps the dialect keys out when the dialect wrote no thinking fields', () => {
    const glm = rulesFor('https://open.bigmodel.cn/api/paas/v4', 'openai_chat', 'glm-4-plus')
    expect(chat(glm, 'glm-4-plus', level('high')).thinking).toBeUndefined()

    const custom = rulesFor('https://llm.example.com/v1', 'openai_chat', 'mystery-model', {
      modelOverrides: { 'mystery-model': { extraBody: { thinking: { keep: 'all' }, reasoning: { x: 1 }, top_k: 5 } } },
    })
    const body = chat(custom, 'mystery-model', level('high'))
    expect(thinkingFields(body)).toEqual({})
    expect(body.top_k).toBe(5)
  })
})

describe('the fallback is not changed by the upper layers', () => {
  const sites: Array<[string, ApiFormat]> = [
    ['https://llm.example.com/v1', 'openai_chat'],
    ['https://llm.example.com/v1', 'openai_responses'],
    ['https://api.openai.com/v1', 'openai_chat'],
    ['https://api.openai.com/v1', 'openai_responses'],
    ['https://api.deepseek.com', 'openai_chat'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai_chat'],
    ['https://api.moonshot.ai/v1', 'openai_chat'],
    ['https://open.bigmodel.cn/api/paas/v4', 'openai_chat'],
    ['https://api.minimax.io/v1', 'openai_chat'],
    ['https://openrouter.ai/api/v1', 'openai_chat'],
    ['https://generativelanguage.googleapis.com/v1beta/openai', 'openai_chat'],
  ]

  test.each(sites)('%s (%s) sends no thinking or output limit fields for an unknown model', (baseUrl, apiFormat) => {
    const rules = rulesFor(baseUrl, apiFormat, 'mystery-model')
    const convert = apiFormat === 'openai_chat' ? chat : responses
    for (const extra of [off, on, level('high'), effortOnly('low'), {}]) {
      const body = convert(rules, 'mystery-model', extra)
      expect(thinkingFields(body)).toEqual({})
      expect(maxTokenFields(body)).toEqual({})
    }
  })

  test.each(sites)('%s (%s) sends the output limit once the user overrides it', (baseUrl, apiFormat) => {
    const rules = rulesFor(baseUrl, apiFormat, 'mystery-model', {
      modelOverrides: { 'mystery-model': { maxOutputTokens: 4096 } },
    })
    const convert = apiFormat === 'openai_chat' ? chat : responses
    expect(maxTokenFields(convert(rules, 'mystery-model', {}))).toEqual({ [rules.maxTokensField]: 4096 })
  })
})

describe('output limit', () => {
  test('sends min(request, model limit) under the site field name when the limit has a source', () => {
    const deepseek = rulesFor('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro')
    expect(maxTokenFields(chat(deepseek, 'deepseek-v4-pro', {}))).toEqual({ max_tokens: 32_000 })

    const qwen = rulesFor('https://dashscope.aliyuncs.com/compatible-mode/v1', 'openai_chat', 'qwen-max')
    expect(maxTokenFields(chat(qwen, 'qwen-max', {}))).toEqual({ max_completion_tokens: 8192 })

    const gpt = rulesFor('https://api.openai.com/v1', 'openai_responses', 'gpt-5.1')
    expect(maxTokenFields(responses(gpt, 'gpt-5.1', { max_tokens: 100 }))).toEqual({ max_output_tokens: 100 })
  })
})

describe('structured output', () => {
  const format = { type: 'json_schema' as const, schema: { type: 'object', properties: { ok: { type: 'boolean' } } } }

  test('maps output_config.format to response_format and text.format when the model supports it', () => {
    const chatRules = rulesFor('https://api.openai.com/v1', 'openai_chat', 'gpt-5.1')
    expect(chat(chatRules, 'gpt-5.1', { output_config: { format } }).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'output', schema: format.schema },
    })

    const responsesRules = rulesFor('https://api.openai.com/v1', 'openai_responses', 'gpt-5.1')
    expect(responses(responsesRules, 'gpt-5.1', { output_config: { format } }).text).toEqual({
      format: { type: 'json_schema', name: 'output', schema: format.schema },
    })
  })

  test('drops the format when the model does not support it', () => {
    const rules = rulesFor('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro')
    const body = chat(rules, 'deepseek-v4-pro', { output_config: { format } })
    expect(body.response_format).toBeUndefined()
    expect(body.output_config).toBeUndefined()
  })
})

describe('images and PDF', () => {
  const image: AnthropicContentBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }
  const pdf: AnthropicContentBlock = {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0' },
  }
  const toolResult: AnthropicContentBlock = {
    type: 'tool_result',
    tool_use_id: 'call_1',
    content: [{ type: 'text', text: 'screenshot taken' }, image],
  }
  const withMedia = (blocks: AnthropicContentBlock[]): Partial<AnthropicRequest> => ({
    messages: [
      { role: 'user', content: 'look' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'Screenshot', input: {} }] },
      { role: 'user', content: blocks },
    ],
  })

  test('chat carries images and PDFs when the model accepts them, with tool result images in the next user message', () => {
    const rules = rulesFor('https://api.openai.com/v1', 'openai_chat', 'gpt-5.1')
    const body = chat(rules, 'gpt-5.1', withMedia([toolResult, { type: 'text', text: 'read this' }, pdf, image]))
    const messages = body.messages as Body[]
    const tool = messages.find(message => message.role === 'tool')!
    expect(tool.content).toContain('screenshot taken')
    expect(JSON.stringify(tool.content)).not.toContain('iVBOR')
    const last = messages.at(-1)!
    expect(last.role).toBe('user')
    const parts = last.content as Body[]
    expect(parts.filter(part => part.type === 'image_url')).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBOR' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBOR' } },
    ])
    expect(parts.find(part => part.type === 'file')).toEqual({
      type: 'file',
      file: { filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBERi0' },
    })
    expect(messages.indexOf(tool)).toBeLessThan(messages.indexOf(last))
  })

  test('chat replaces images and PDFs with explanatory text when the model does not accept them', () => {
    const rules = rulesFor('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro')
    const body = chat(rules, 'deepseek-v4-pro', withMedia([toolResult, pdf, image]))
    const text = JSON.stringify(body.messages)
    expect(text).not.toContain('iVBOR')
    expect(text).not.toContain('JVBERi0')
    expect(text).toContain('does not accept image input')
    expect(text).toContain('does not accept PDF input')
    expect(text).toContain('pages')
  })

  test('Responses carries images and PDFs as input parts, also inside tool output', () => {
    const rules = rulesFor('https://api.openai.com/v1', 'openai_responses', 'gpt-5.1')
    const body = responses(rules, 'gpt-5.1', withMedia([toolResult, pdf]))
    const input = body.input as Body[]
    const output = input.find(item => item.type === 'function_call_output')!
    expect(output.output).toEqual([
      { type: 'input_text', text: 'screenshot taken' },
      { type: 'input_image', image_url: 'data:image/png;base64,iVBOR' },
    ])
    const message = input.at(-1)!
    expect(message.content).toEqual([
      { type: 'input_file', filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBERi0' },
    ])
  })

  test('Responses replaces media with text when the model does not accept it', () => {
    const rules = rulesFor('https://llm.example.com/v1', 'openai_responses', 'mystery-model', {
      modelOverrides: { 'mystery-model': { image: false } },
    })
    const body = responses(rules, 'mystery-model', withMedia([toolResult, pdf]))
    const text = JSON.stringify(body.input)
    expect(text).not.toContain('iVBOR')
    expect(text).not.toContain('JVBERi0')
    expect(text).toContain('does not accept image input')
    expect(text).toContain('does not accept PDF input')
  })
})

describe('think tags in text', () => {
  const rules: ResolvedModelRules = {
    ...rulesFor('https://llm.example.com/v1', 'openai_chat', 'mystery-model'),
    thinkTagsInText: true,
  }

  test('the chat stream splits <think> content into a thinking block across chunk boundaries', async () => {
    const events = await collectSse(openaiChatStreamToAnthropic(makeStream([
      chatChunk({ role: 'assistant', content: '<thi' }),
      chatChunk({ content: 'nk>plan it</th' }),
      chatChunk({ content: 'ink>\n\nthe answer' }),
      chatChunk({}, 'stop'),
      'data: [DONE]\n\n',
    ]), 'm', rules))
    expect(blockSequence(events).filter(entry => entry.startsWith('start') || entry === 'stop')).toEqual([
      'start:thinking', 'stop', 'start:text', 'stop',
    ])
    const deltas = deltasOf(events)
    expect(deltas.filter(d => d.type === 'thinking_delta').map(d => d.thinking).join('')).toBe('plan it')
    expect(deltas.filter(d => d.type === 'text_delta').map(d => d.text).join('')).toBe('the answer')
  })

  test('text stays text when the endpoint does not use think tags', async () => {
    const plain = rulesFor('https://llm.example.com/v1', 'openai_chat', 'mystery-model')
    const events = await collectSse(openaiChatStreamToAnthropic(makeStream([
      chatChunk({ role: 'assistant', content: '<think>x</think>y' }),
      chatChunk({}, 'stop'),
      'data: [DONE]\n\n',
    ]), 'm', plain))
    expect(deltasOf(events)).toEqual([{ type: 'text_delta', text: '<think>x</think>y' }])
  })

  test('a non-streaming chat reply is split the same way', () => {
    const response: OpenAIChatResponse = {
      id: 'c1', object: 'chat.completion', created: 0, model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: '<think>plan</think>\nanswer' }, finish_reason: 'stop' }],
    }
    expect(openaiChatToAnthropic(response, 'm', rules).content).toEqual([
      { type: 'thinking', thinking: 'plan' },
      { type: 'text', text: 'answer' },
    ])
  })
})

describe('reasoning signatures on the response side', () => {
  const deepseek = rulesFor('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro')
  const openrouter = rulesFor('https://openrouter.ai/api/v1', 'openai_chat', 'deepseek/deepseek-v4-pro')

  test('a reasoning_content block ends with one dc1 signature', async () => {
    const events = await collectSse(openaiChatStreamToAnthropic(makeStream([
      chatChunk({ role: 'assistant', reasoning_content: 'Let me ' }),
      chatChunk({ reasoning_content: 'think' }),
      chatChunk({ content: 'done' }),
      chatChunk({}, 'stop'),
      'data: [DONE]\n\n',
    ]), 'm', deepseek))
    expect(blockSequence(events)).toEqual([
      'start:thinking', 'thinking_delta', 'thinking_delta', 'signature_delta', 'stop',
      'start:text', 'text_delta', 'stop',
    ])
    expect(deltasOf(events).find(d => d.type === 'signature_delta')).toEqual({
      type: 'signature_delta',
      signature: 'dc1:reasoning_content:',
    })
  })

  test('chunked reasoning_details are buffered into one signature', async () => {
    const events = await collectSse(openaiChatStreamToAnthropic(makeStream([
      chatChunk({ role: 'assistant', reasoning: 'Step ', reasoning_details: [{ type: 'reasoning.text', text: 'Step ', index: 0, format: 'unknown' }] }),
      chatChunk({ reasoning: 'one', reasoning_details: [{ type: 'reasoning.text', text: 'one', index: 0, format: 'unknown' }] }),
      chatChunk({ reasoning_details: [{ type: 'reasoning.text', signature: 'sig-1', index: 0, format: 'unknown' }] }),
      chatChunk({ content: 'ok' }),
      chatChunk({}, 'stop'),
      'data: [DONE]\n\n',
    ]), 'm', openrouter))
    const signatures = deltasOf(events).filter(d => d.type === 'signature_delta')
    expect(signatures).toHaveLength(1)
    const signature = signatures[0]!.signature as string
    expect(signature.startsWith('dc1:reasoning_details:')).toBe(true)
    expect(JSON.parse(signature.slice('dc1:reasoning_details:'.length))).toEqual([
      { type: 'reasoning.text', text: 'Step one', signature: 'sig-1', index: 0, format: 'unknown' },
    ])
    expect(deltasOf(events).filter(d => d.type === 'thinking_delta').map(d => d.thinking).join('')).toBe('Step one')
  })

  test('no signature is written when the endpoint turns reasoning replay off', async () => {
    const events = await collectSse(openaiChatStreamToAnthropic(makeStream([
      chatChunk({ role: 'assistant', reasoning_content: 'hmm' }),
      chatChunk({}, 'stop'),
      'data: [DONE]\n\n',
    ]), 'm', { ...deepseek, reasoningReplay: 'off' }))
    expect(deltasOf(events).filter(d => d.type === 'signature_delta')).toEqual([])
  })

  test('a non-streaming chat reply records the source', () => {
    const response = {
      id: 'c1', object: 'chat.completion', created: 0, model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok', reasoning_content: 'why' }, finish_reason: 'stop' }],
    } as OpenAIChatResponse
    expect(openaiChatToAnthropic(response, 'm', deepseek).content[0]).toEqual({
      type: 'thinking', thinking: 'why', signature: 'dc1:reasoning_content:',
    })
  })

  test('a Responses reasoning item carries its encrypted content in the signature', async () => {
    const rules = rulesFor('https://api.openai.com/v1', 'openai_responses', 'gpt-5.1')
    const events = await collectSse(openaiResponsesStreamToAnthropic(makeStream([
      'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"reasoning","id":"rs_1"}}\n\n',
      'event: response.reasoning_summary_text.delta\ndata: {"item_id":"rs_1","delta":"Plan"}\n\n',
      'event: response.reasoning_summary_text.done\ndata: {"item_id":"rs_1","text":"Plan"}\n\n',
      'event: response.reasoning_summary_part.done\ndata: {"item_id":"rs_1"}\n\n',
      'event: response.output_item.done\ndata: {"output_index":0,"item":{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"Plan"}],"encrypted_content":"enc-1"}}\n\n',
      'event: response.output_text.delta\ndata: {"output_index":1,"content_index":0,"delta":"ok"}\n\n',
      'event: response.completed\ndata: {"response":{"status":"completed"}}\n\n',
    ]), 'gpt-5.1', rules))
    expect(blockSequence(events)).toEqual([
      'start:thinking', 'thinking_delta', 'signature_delta', 'stop', 'start:text', 'text_delta', 'stop',
    ])
    expect(deltasOf(events)[1]).toEqual({ type: 'signature_delta', signature: 'dc1:encrypted_content:enc-1' })
  })

  test('a non-streaming Responses reply carries the encrypted content too', () => {
    const rules = rulesFor('https://api.openai.com/v1', 'openai_responses', 'gpt-5.1')
    const response: OpenAIResponsesResponse = {
      id: 'r1', object: 'response', created_at: 0, model: 'gpt-5.1', status: 'completed',
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'A' }, { type: 'summary_text', text: 'B' }], encrypted_content: 'enc-2' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
      ],
    }
    expect(openaiResponsesToAnthropic(response, 'gpt-5.1', rules).content[0]).toEqual({
      type: 'thinking', thinking: 'A\n\nB', signature: 'dc1:encrypted_content:enc-2',
    })
  })
})

describe('reasoning write-back on the request side', () => {
  const details = [{ type: 'reasoning.text', text: 'plan', signature: 'sig', index: 0 }]
  const detailsSignature = `dc1:reasoning_details:${JSON.stringify(details)}`

  test('DeepSeek writes marked and unmarked blocks back as reasoning_content', () => {
    const rules = rulesFor('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro')
    expect(assistantOf(chat(rules, 'deepseek-v4-pro', historyWith([thinkingBlock('marked ', 'dc1:reasoning_content:')]))).reasoning_content)
      .toBe('marked ')
    expect(assistantOf(chat(rules, 'deepseek-v4-pro', historyWith([thinkingBlock('old')]))).reasoning_content).toBe('old')
    expect(assistantOf(chat(rules, 'deepseek-v4-pro', historyWith([thinkingBlock('', '')]))).reasoning_content).toBeUndefined()
  })

  test('a block marked as reasoning_details is written back as reasoning_content after switching to DeepSeek', () => {
    const rules = rulesFor('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro')
    const assistant = assistantOf(chat(rules, 'deepseek-v4-pro', historyWith([thinkingBlock('plan', detailsSignature)])))
    expect(assistant.reasoning_content).toBe('plan')
    expect(assistant.reasoning_details).toBeUndefined()
  })

  test('OpenRouter writes reasoning_details back and drops unmarked blocks', () => {
    const rules = rulesFor('https://openrouter.ai/api/v1', 'openai_chat', 'deepseek/deepseek-v4-pro')
    const assistant = assistantOf(chat(rules, 'deepseek/deepseek-v4-pro', historyWith([thinkingBlock('plan', detailsSignature)])))
    expect(assistant.reasoning_details).toEqual(details)
    expect(assistant.reasoning_content).toBeUndefined()
    const unmarked = assistantOf(chat(rules, 'deepseek/deepseek-v4-pro', historyWith([thinkingBlock('old')])))
    expect(unmarked.reasoning_content).toBeUndefined()
    expect(unmarked.reasoning_details).toBeUndefined()
  })

  test('a reasoning field block is written back under reasoning on a chat endpoint', () => {
    const rules = rulesFor('https://llm.example.com/v1', 'openai_chat', 'mystery-model')
    expect(assistantOf(chat(rules, 'mystery-model', historyWith([thinkingBlock('r', 'dc1:reasoning:')]))).reasoning).toBe('r')
    expect(assistantOf(chat(rules, 'mystery-model', historyWith([thinkingBlock('old')]))).reasoning_content).toBeUndefined()
  })

  test('nothing marked is written back when replay is off', () => {
    const rules = { ...rulesFor('https://api.deepseek.com', 'openai_chat', 'deepseek-v4-pro'), reasoningReplay: 'off' as const }
    expect(assistantOf(chat(rules, 'deepseek-v4-pro', historyWith([thinkingBlock('m', 'dc1:reasoning_content:')]))).reasoning_content)
      .toBeUndefined()
  })

  test('Responses writes encrypted reasoning back as a reasoning item before the call', () => {
    const rules = rulesFor('https://api.openai.com/v1', 'openai_responses', 'gpt-5.1')
    const body = responses(rules, 'gpt-5.1', historyWith([thinkingBlock('Plan', 'dc1:encrypted_content:enc-1')]))
    const input = body.input as Body[]
    const reasoningIndex = input.findIndex(item => item.type === 'reasoning')
    expect(input[reasoningIndex]).toEqual({
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'Plan' }],
      encrypted_content: 'enc-1',
    })
    expect(input[reasoningIndex + 1]!.type).toBe('function_call')
  })

  test('encrypted reasoning is not written to a chat endpoint', () => {
    const rules = rulesFor('https://llm.example.com/v1', 'openai_chat', 'mystery-model')
    const assistant = assistantOf(chat(rules, 'mystery-model', historyWith([thinkingBlock('Plan', 'dc1:encrypted_content:enc-1')])))
    expect(assistant.reasoning_content).toBeUndefined()
    expect(JSON.stringify(assistant)).not.toContain('enc-1')
  })
})

describe('sendToUpstream with model rules', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let originalFetch: typeof globalThis.fetch
  let calls: Array<{ url: string; body: Body }>

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-model-rules-'))
    originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
    process.env.DREAMCODER_CONFIG_DIR = tmpDir
    originalFetch = globalThis.fetch
    calls = []
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Body })
      return new Response(`${chatChunk({ role: 'assistant', content: 'ok' })}${chatChunk({}, 'stop')}data: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof fetch
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
    else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('resolves the rules from the provider and maps thinking without effort onto the global effort', async () => {
    await new SettingsService().updateUserSettings({ effort: 'low' })
    const provider = { baseUrl: 'https://api.deepseek.com', apiFormat: 'openai_chat' as const }
    const result = await sendToUpstream(
      { target: { ...provider, apiKey: 'sk-test', authStrategy: 'api_key' }, provider },
      request('deepseek-v4-pro[1m]', { ...on, stream: true }),
    )
    expect(result.ok).toBe(true)
    expect(calls[0]!.body.model).toBe('deepseek-v4-pro')
    expect(thinkingFields(calls[0]!.body)).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'low' })
    expect(calls[0]!.body.max_tokens).toBe(32_000)
  })

  test('a saved Kimi preset tested as OpenAI chat on Moonshot uses the overridden provider rules', async () => {
    const svc = new ProviderService()
    const saved = await svc.addProvider({
      presetId: 'kimi',
      name: 'Kimi',
      baseUrl: 'https://api.kimi.com/coding',
      apiKey: 'sk-test',
      apiFormat: 'anthropic',
      runtimeKind: 'anthropic_compatible',
      models: [{ id: 'kimi-k2.6' }],
    })
    const result = await svc.testProvider(saved.id, {
      baseUrl: 'https://api.moonshot.ai/v1',
      apiFormat: 'openai_chat',
      modelId: 'kimi-k2.6',
    })
    expect(result.connectivity.success).toBe(true)
    expect(calls[0]!.url).toBe('https://api.moonshot.ai/v1/chat/completions')
    expect(thinkingFields(calls[0]!.body)).toEqual({ thinking: { type: 'disabled', keep: 'all' } })
  })
})
