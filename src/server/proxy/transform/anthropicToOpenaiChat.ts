import type { ResolvedModelRules } from '../../types/modelRules.js'
import type {
  AnthropicRequest,
  AnthropicContentBlock,
  AnthropicMessage,
  OpenAIChatRequest,
  OpenAIChatMessage,
  OpenAIChatContentPart,
  OpenAIToolCall,
  OpenAITool,
} from './types.js'
import { joinText, mediaPart, toolResultParts, type MediaPart } from './media.js'
import { chatReasoningReplay } from './reasoningReplay.js'
import { applyRequestRules, outputFormatFor, type RequestRulesOptions } from './requestRules.js'
import { cleanToolSchema } from './toolSchema.js'

export function anthropicToOpenaiChat(
  body: AnthropicRequest,
  rules: ResolvedModelRules,
  options: RequestRulesOptions = {},
): OpenAIChatRequest {
  const messages: OpenAIChatMessage[] = []

  if (body.system) {
    if (typeof body.system === 'string') {
      messages.push({ role: 'system', content: body.system })
    } else if (Array.isArray(body.system)) {
      const text = body.system.map((b) => b.text).join('\n')
      messages.push({ role: 'system', content: text })
    }
  }

  for (const msg of body.messages) {
    convertMessage(msg, messages, rules)
  }

  const result: OpenAIChatRequest = {
    model: body.model,
    messages,
    stream: body.stream,
  }

  if (body.stream) result.stream_options = { include_usage: true }

  if (body.temperature !== undefined) result.temperature = body.temperature
  if (body.top_p !== undefined) result.top_p = body.top_p

  if (body.stop_sequences && body.stop_sequences.length > 0) {
    result.stop = body.stop_sequences
  }

  if (body.tools && body.tools.length > 0) {
    result.tools = body.tools
      .filter((t) => t.name !== 'BatchTool')
      .map((t): OpenAITool => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: cleanToolSchema(t.input_schema),
        },
      }))
    if (result.tools.length > 0) result.parallel_tool_calls = true
  }

  if (body.tool_choice !== undefined) {
    result.tool_choice = convertToolChoice(body.tool_choice)
  }

  const format = outputFormatFor(body, rules)
  if (format) result.response_format = { type: 'json_schema', json_schema: { name: 'output', schema: format.schema } }

  applyRequestRules(result, body, rules, options)
  return result
}

function chatPart(part: MediaPart): OpenAIChatContentPart {
  switch (part.kind) {
    case 'text':
      return { type: 'text', text: part.text }
    case 'image':
      return { type: 'image_url', image_url: { url: part.url } }
    case 'file':
      return { type: 'file', file: { filename: part.filename, file_data: part.fileData } }
  }
}

function convertMessage(
  msg: AnthropicMessage,
  output: OpenAIChatMessage[],
  rules: ResolvedModelRules,
): void {
  const content = msg.content

  if (typeof content === 'string') {
    output.push({ role: msg.role, content })
    return
  }

  if (!Array.isArray(content) || content.length === 0) {
    output.push({ role: msg.role, content: '' })
    return
  }

  if (msg.role === 'user') {
    convertUserMessage(content, output, rules)
  } else {
    convertAssistantMessage(content, output, rules)
  }
}

function convertUserMessage(blocks: AnthropicContentBlock[], output: OpenAIChatMessage[], rules: ResolvedModelRules): void {
  const toolAttachments: OpenAIChatContentPart[] = []
  const ownParts: OpenAIChatContentPart[] = []

  for (const block of blocks) {
    if (block.type === 'text') {
      ownParts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image' || block.type === 'document') {
      ownParts.push(chatPart(mediaPart(block, rules)))
    } else if (block.type === 'tool_result') {
      const parts = toolResultParts(block.content, rules)
      const attachments = parts.filter(part => part.kind !== 'text')
      const note = attachments.length > 0 ? '[Attachments from this result are in the next user message.]' : ''
      output.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: [joinText(parts), note].filter(Boolean).join('\n'),
      })
      if (attachments.length > 0) {
        toolAttachments.push({ type: 'text', text: `[Attachments from tool result ${block.tool_use_id}]` }, ...attachments.map(chatPart))
      }
    }
  }

  const contentParts = [...toolAttachments, ...ownParts]
  if (contentParts.length > 0) {
    output.push({
      role: 'user',
      content: contentParts.length === 1 && contentParts[0].type === 'text'
        ? contentParts[0].text
        : contentParts,
    })
  }
}

function convertAssistantMessage(
  blocks: AnthropicContentBlock[],
  output: OpenAIChatMessage[],
  rules: ResolvedModelRules,
): void {
  let textContent = ''
  const thinkingBlocks: Extract<AnthropicContentBlock, { type: 'thinking' }>[] = []
  const toolCalls: OpenAIToolCall[] = []

  for (const block of blocks) {
    if (block.type === 'text') {
      textContent += block.text
    } else if (block.type === 'thinking') {
      thinkingBlocks.push(block)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
        },
      })
    }
  }

  const msg: OpenAIChatMessage = {
    role: 'assistant',
    content: textContent || null,
    ...chatReasoningReplay(thinkingBlocks, rules),
  }

  if (toolCalls.length > 0) {
    msg.tool_calls = toolCalls
  }

  output.push(msg)
}

function convertToolChoice(choice: unknown): unknown {
  if (typeof choice === 'string') return choice
  if (typeof choice === 'object' && choice !== null) {
    const c = choice as Record<string, unknown>
    if (c.type === 'auto') return 'auto'
    if (c.type === 'any') return 'required'
    if (c.type === 'none') return 'none'
    if (c.type === 'tool' && typeof c.name === 'string') {
      return { type: 'function', function: { name: c.name } }
    }
  }
  return 'auto'
}
