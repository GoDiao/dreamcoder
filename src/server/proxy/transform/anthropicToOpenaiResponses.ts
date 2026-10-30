import type {
  AnthropicRequest,
  AnthropicMessage,
  OpenAIResponsesRequest,
  OpenAIResponsesInputItem,
  OpenAIResponsesContentPart,
} from './types.js'
import { extractToolResultContent } from './toolArguments.js'

export function anthropicToOpenaiResponses(body: AnthropicRequest): OpenAIResponsesRequest {
  const input: OpenAIResponsesInputItem[] = []

  for (const msg of body.messages) {
    convertMessageToInputItems(msg, input)
  }

  const result: OpenAIResponsesRequest = {
    model: body.model,
    input,
    stream: body.stream,
    store: false,
  }

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
        parameters: t.input_schema,
      }))
  }

  if (body.tool_choice !== undefined) {
    result.tool_choice = convertToolChoice(body.tool_choice)
  }

  if (body.thinking) {
    const budget = body.thinking.budget_tokens
    if (budget !== undefined) {
      if (budget <= 1024) result.reasoning = { effort: 'low' }
      else if (budget <= 8192) result.reasoning = { effort: 'medium' }
      else result.reasoning = { effort: 'high' }
    } else if (body.thinking.type === 'enabled') {
      result.reasoning = { effort: 'high' }
    }
  }

  return result
}

function convertMessageToInputItems(msg: AnthropicMessage, output: OpenAIResponsesInputItem[]): void {
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
    } else if (block.type === 'image') {
      contentParts.push({
        type: 'input_image',
        image_url: `data:${block.source.media_type};base64,${block.source.data}`,
      })
    } else if (block.type === 'tool_use') {
      flushContentParts(contentParts, msg.role, textType, output)
      output.push({
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
      })
    } else if (block.type === 'tool_result') {
      const resultContent = extractToolResultContent(block.content)
      output.push({
        type: 'function_call_output',
        call_id: block.tool_use_id,
        output: resultContent,
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
