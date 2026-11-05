import { z } from 'zod/v4'
import {
  SDKControlSessionStartResponseSchema,
  type SDKControlSessionStartResponse,
} from '../../entrypoints/sdk/controlSchemas.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { requestHost } from '../../utils/hostRequests.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'
import {
  isSessionLinksEnabled,
  START_SESSION_TOOL_NAME,
} from './constants.js'
import {
  DESCRIPTION,
  PROMPT,
  START_SESSION_PERMISSION_REASON,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    prompt: z.string().min(1).describe('The brief the new session starts with.'),
    title: z.string().min(1).describe('Short title shown in the session list.'),
    context: z
      .enum(['fresh', 'fork'])
      .describe('"fresh" starts empty; "fork" starts with a copy of this conversation.'),
    worktree: semanticBoolean(z.boolean().default(false)).describe(
      "Run the new session in a new git worktree of this session's repository.",
    ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => SDKControlSessionStartResponseSchema())
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = SDKControlSessionStartResponse

export const StartSessionTool = buildTool({
  name: START_SESSION_TOOL_NAME,
  searchHint: 'start a new separate session that works on a task on its own',
  maxResultSizeChars: 10_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return START_SESSION_TOOL_NAME
  },
  isEnabled() {
    return isSessionLinksEnabled()
  },
  isReadOnly() {
    return false
  },
  isConcurrencySafe() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.title}: ${input.prompt}`
  },
  async checkPermissions(input) {
    return {
      behavior: 'ask',
      message: `Start a new session "${input.title}"?`,
      updatedInput: input,
      decisionReason: {
        type: 'safetyCheck',
        reason: START_SESSION_PERMISSION_REASON,
        classifierApprovable: false,
      },
    }
  },
  renderToolUseMessage(input) {
    return input.title ?? null
  },
  async call(input) {
    const started = await requestHost(
      {
        subtype: 'session_start',
        prompt: input.prompt,
        title: input.title,
        context: input.context,
        worktree: input.worktree,
      },
      SDKControlSessionStartResponseSchema(),
    )
    return { data: started }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Started session "${output.title}" (id ${output.sessionId}).`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
