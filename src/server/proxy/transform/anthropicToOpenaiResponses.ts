import type { ResolvedModelRules } from '../../types/modelRules.js'
import type {
  AnthropicRequest,
  AnthropicMessage,
  OpenAIResponsesRequest,
  OpenAIResponsesInputItem,
  OpenAIResponsesContentPart,
} from './types.js'
import { joinText, mediaPart, toolResultParts, type MediaPart } from './media.js'
import { responsesReasoningItem } from './reasoningReplay.js'
import { applyRequestRules, outputFormatFor, type RequestRulesOptions } from './requestRules.js'
import { cleanToolSchema } from './toolSchema.js'

export function anthropicToOpenaiResponses(
  body: AnthropicRequest,
  rules: ResolvedModelRules,
  options: RequestRulesOptions & { promptCacheKey?: string } = {},
): OpenAIResponsesRequest {
  const input: OpenAIResponsesInputItem[] = []

  for (const msg of body.messages) {
    convertMessageToInputItems(msg, input, rules)
  }

  const result: OpenAIResponsesRequest = {
    model: body.model,
    input,
    stream: body.stream,
    store: false,
  }

  if (options.promptCacheKey) result.prompt_cache_key = options.promptCacheKey

  if (body.system) {
    if (typeof body.system === 'string') {
      result.instructions = body.system
    } else if (Array.isArray(body.system)) {
      result.instructions = body.system.map((b) => b.text).join('\n')
    }
  }

  if (body.temperature !== undefined) result.temperature = body.temperature
  if (body.top_p !== undefined) result.top_p = body.top_p

  if (body.tools && body.tools.length > 0) {
    result.tools = body.tools
      .filter((t) => t.name !== 'BatchTool')
      .map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: cleanToolSchema(t.input_schema),
        strict: false,
      }))
    if (result.tools.length > 0) result.parallel_tool_calls = true
  }

  if (body.tool_choice !== undefined) {
    result.tool_choice = convertToolChoice(body.tool_choice)
  }

  if (rules.reasoningReplay === 'same_as_received' && rules.reasoning.control !== 'none') {
    result.include = ['reasoning.encrypted_content']
  }

  const format = outputFormatFor(body, rules)
  if (format) result.text = { format: { type: 'json_schema', name: 'output', schema: format.schema } }

  applyRequestRules(result, body, rules, options)
  return result
}

function responsesPart(part: MediaPart, textType: 'input_text' | 'output_text'): OpenAIResponsesContentPart {
  switch (part.kind) {
    case 'text':
      return { type: textType, text: part.text }
    case 'image':
      return { type: 'input_image', image_url: part.url }
    case 'file':
      return { type: 'input_file', filename: part.filename, file_data: part.fileData }
  }
}

function toolOutput(content: Parameters<typeof toolResultParts>[0], rules: ResolvedModelRules): string | OpenAIResponsesContentPart[] {
  const parts = toolResultParts(content, rules)
  if (parts.every(part => part.kind === 'text')) return joinText(parts)
  return parts.map(part => responsesPart(part, 'input_text'))
}

function convertMessageToInputItems(msg: AnthropicMessage, output: OpenAIResponsesInputItem[], rules: ResolvedModelRules): void {
  const content = msg.content

  if (typeof content === 'string') {
    output.push({ type: 'message', role: msg.role, content })
    return
  }

  if (!Array.isArray(content) || content.length === 0) {
    output.push({ type: 'message', role: msg.role, content: '' })
    return
  }

  const contentParts: OpenAIResponsesContentPart[] = []
  // Earlier assistant turns are model output, which Responses expects as output_text.
  const textType = msg.role === 'assistant' ? 'output_text' : 'input_text'

  for (const block of content) {
    if (block.type === 'text') {
      contentParts.push({ type: textType, text: block.text })
    } else if (block.type === 'image' || block.type === 'document') {
      contentParts.push(responsesPart(mediaPart(block, rules), textType))
    } else if (block.type === 'thinking') {
      const item = responsesReasoningItem(block, rules)
      if (item) {
        flushContentParts(contentParts, msg.role, textType, output)
        output.push(item)
      }
    } else if (block.type === 'tool_use') {
      flushContentParts(contentParts, msg.role, textType, output)
      output.push({
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
      })
    } else if (block.type === 'tool_result') {
      output.push({
        type: 'function_call_output',
        call_id: block.tool_use_id,
        output: toolOutput(block.content, rules),
      })
    }
  }

  flushContentParts(contentParts, msg.role, textType, output)
}

// A lone text part is sent as a plain string; anything else as a parts array.
function flushContentParts(
  parts: OpenAIResponsesContentPart[],
  role: AnthropicMessage['role'],
  textType: 'input_text' | 'output_text',
  output: OpenAIResponsesInputItem[],
): void {
  if (parts.length === 0) return
  const only = parts[0]
  const content = parts.length === 1 && only.type === textType ? only.text : [...parts]
  if (content !== '') output.push({ type: 'message', role, content })
  parts.length = 0
}

function convertToolChoice(choice: unknown): unknown {
  if (typeof choice === 'string') return choice
  if (typeof choice === 'object' && choice !== null) {
    const c = choice as Record<string, unknown>
    if (c.type === 'auto') return 'auto'
    if (c.type === 'any') return 'required'
    if (c.type === 'none') return 'none'
    if (c.type === 'tool' && typeof c.name === 'string') {
      return { type: 'function', name: c.name }
    }
  }
  return 'auto'
}
