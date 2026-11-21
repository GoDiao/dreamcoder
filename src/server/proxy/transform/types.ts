import type { EffortLevel } from '../../../utils/effort.js'

type ReasoningEffort = EffortLevel | 'none'

export type ReasoningFields = {
  thinking?: { type: 'enabled' | 'disabled' | 'adaptive' }
  reasoning_effort?: ReasoningEffort
  enable_thinking?: boolean
  reasoning?: { effort: ReasoningEffort; summary?: 'auto' } | { enabled: true }
}

export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | OpenAIChatContentPart[] | null
  name?: string
  reasoning_content?: string
  reasoning?: string
  reasoning_details?: unknown[]
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export type OpenAIChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

export type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: unknown
  }
}

export type OpenAITool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export type OpenAIChatRequest = {
  model: string
  messages: OpenAIChatMessage[]
  max_tokens?: number
  max_completion_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string | string[]
  stream?: boolean
  stream_options?: { include_usage: boolean }
  tools?: OpenAITool[]
  tool_choice?: unknown
  parallel_tool_calls?: boolean
  response_format?: { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown> } }
} & ReasoningFields

export type OpenAIChatResponse = {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string | null
      tool_calls?: OpenAIToolCall[]
      reasoning_content?: string
      reasoning?: string
      reasoning_details?: unknown[]
      thinking_blocks?: unknown[]
    }
    finish_reason: string | null
    usage?: OpenAIChatUsage
  }>
  usage?: OpenAIChatUsage
}

export type OpenAIChatUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: {
    cached_tokens?: number
  }
  prompt_cache_hit_tokens?: number
  cached_tokens?: number
}

export type OpenAIChatStreamChunk = {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: unknown
        }
      }>
    }
    finish_reason: string | null
    usage?: OpenAIChatUsage
  }>
  usage?: OpenAIChatUsage
}

export type OpenAIResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_file'; filename: string; file_data: string }

export type OpenAIResponsesInputItem =
  | { type: 'message'; role: 'user' | 'assistant' | 'system'; content: string | OpenAIResponsesContentPart[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: unknown }
  | { type: 'function_call_output'; call_id: string; output: string | OpenAIResponsesContentPart[] }
  | { type: 'reasoning'; summary: Array<{ type: 'summary_text'; text: string }>; encrypted_content: string }

export type OpenAIResponsesRequest = {
  model: string
  input: OpenAIResponsesInputItem[]
  instructions?: string
  store?: boolean
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: Array<{
    type: 'function'
    name: string
    description?: string
    parameters?: Record<string, unknown>
    strict: false
  }>
  tool_choice?: unknown
  parallel_tool_calls?: boolean
  reasoning?: { effort: ReasoningEffort }
  include?: string[]
  text?: { format: { type: 'json_schema'; name: string; schema: Record<string, unknown> } }
  prompt_cache_key?: string
}

export type OpenAIResponsesOutputItem =
  | { type: 'message'; role: string; content: Array<{ type: string; text?: string; refusal?: string }> }
  | { type: 'function_call'; id: string; call_id: string; name: string; arguments: unknown }
  | { type: 'reasoning'; id: string; summary?: Array<{ type: string; text: string }>; encrypted_content?: string }

export type OpenAIResponsesResponse = {
  id: string
  object: string
  created_at: number
  model: string
  status: string
  incomplete_details?: { reason?: string } | null
  output: OpenAIResponsesOutputItem[]
  usage?: OpenAIResponsesUsage
}

export type OpenAIResponsesUsage = {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  input_tokens_details?: { cached_tokens?: number }
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string; cache_control?: unknown }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string }; cache_control?: unknown }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> | string; cache_control?: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[]; is_error?: boolean; cache_control?: unknown }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'document'; source: AnthropicDocumentSource; title?: string; cache_control?: unknown }

type AnthropicDocumentSource =
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'text'; media_type: string; data: string }
  | { type: 'url'; url: string }

export type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export type AnthropicRequest = {
  model: string
  system?: string | Array<{ type: 'text'; text: string; cache_control?: unknown }>
  messages: AnthropicMessage[]
  max_tokens: number
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
  stream?: boolean
  tools?: Array<{
    name: string
    description?: string
    input_schema: Record<string, unknown>
    cache_control?: unknown
  }>
  tool_choice?: unknown
  thinking?: {
    type: string
    budget_tokens?: number
  }
  output_config?: {
    effort?: EffortLevel
    format?: AnthropicOutputFormat
  }
}

export type AnthropicOutputFormat = { type: 'json_schema'; schema: Record<string, unknown> }

export type AnthropicResponse = {
  id: string
  type: 'message'
  role: 'assistant'
  content: AnthropicContentBlock[]
  model: string
  stop_reason: string | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}
