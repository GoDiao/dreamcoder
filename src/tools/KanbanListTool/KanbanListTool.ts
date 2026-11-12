import { z } from 'zod/v4'
import {
  KANBAN_CARD_STATUSES,
  KANBAN_LIST_SCOPES,
  SDKControlKanbanQueryResponseSchema,
  type SDKControlKanbanQueryResponse,
} from '../../entrypoints/sdk/controlSchemas.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { requestHost } from '../../utils/hostRequests.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { isSessionLinksEnabled } from '../StartSessionTool/constants.js'
import { KANBAN_LIST_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    scope: z
      .enum(KANBAN_LIST_SCOPES)
      .optional()
      .describe('"mine" (default): cards you own, review or created. "all": every card on the board.'),
    status: z.array(z.enum(KANBAN_CARD_STATUSES)).min(1).optional().describe('Only list cards in these states.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => SDKControlKanbanQueryResponseSchema())
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = SDKControlKanbanQueryResponse

export const KanbanListTool = buildTool({
  name: KANBAN_LIST_TOOL_NAME,
  searchHint: 'list cards on the project board, kanban tasks',
  maxResultSizeChars: 50_000,
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
    return KANBAN_LIST_TOOL_NAME
  },
  isEnabled() {
    return isSessionLinksEnabled()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.scope ?? 'mine'
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage(input) {
    return input.scope ?? 'mine'
  },
  async call(input) {
    const listed = await requestHost(
      {
        subtype: 'kanban_query',
        list: { scope: input.scope ?? 'mine', ...(input.status ? { status: input.status } : {}) },
      },
      SDKControlKanbanQueryResponseSchema(),
    )
    return { data: listed }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: jsonStringify(output) }
  },
} satisfies ToolDef<InputSchema, Output>)
