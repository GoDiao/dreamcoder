import { z } from 'zod/v4'
import {
  SDKControlKanbanQueryResponseSchema,
  type SDKControlKanbanQueryResponse,
} from '../../entrypoints/sdk/controlSchemas.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { requestHost } from '../../utils/hostRequests.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { KANBAN_GET_TOOL_NAME } from '../KanbanListTool/constants.js'
import { isSessionLinksEnabled } from '../StartSessionTool/constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    card: z.number().int().positive().describe('The card number, as in "#12".'),
    history: z.boolean().optional().describe('Include every update and delivery. By default only the latest ones are returned.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => SDKControlKanbanQueryResponseSchema())
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = SDKControlKanbanQueryResponse

export const KanbanGetTool = buildTool({
  name: KANBAN_GET_TOOL_NAME,
  searchHint: 'read a card on the project board',
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
    return KANBAN_GET_TOOL_NAME
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
    return `#${input.card}`
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage(input) {
    return input.card === undefined ? null : `#${input.card}`
  },
  async call(input) {
    const found = await requestHost(
      { subtype: 'kanban_query', card: input.card, ...(input.history ? { history: true } : {}) },
      SDKControlKanbanQueryResponseSchema(),
    )
    return { data: found }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: jsonStringify(output) }
  },
} satisfies ToolDef<InputSchema, Output>)
