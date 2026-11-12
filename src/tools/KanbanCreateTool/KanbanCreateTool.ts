import {
  KanbanCreateCardCommandSchema,
  SDKControlKanbanCommandResponseSchema,
  SDKControlKanbanQueryResponseSchema,
  type SDKControlKanbanCommandResponse,
} from '../../entrypoints/sdk/controlSchemas.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { requestHost } from '../../utils/hostRequests.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { KANBAN_CREATE_TOOL_NAME } from '../KanbanListTool/constants.js'
import { isSessionLinksEnabled } from '../StartSessionTool/constants.js'
import { DESCRIPTION, KANBAN_BOARD_PERMISSION_REASON, KANBAN_CARD_PERMISSION_REASON, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() => KanbanCreateCardCommandSchema().omit({ type: true }).strict())
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => SDKControlKanbanCommandResponseSchema())
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = SDKControlKanbanCommandResponse

export const KanbanCreateTool = buildTool({
  name: KANBAN_CREATE_TOOL_NAME,
  searchHint: 'create a card on the project board, kanban task',
  maxResultSizeChars: 20_000,
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
    return KANBAN_CREATE_TOOL_NAME
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
    return input.title
  },
  async checkPermissions(input) {
    const { approval } = await requestHost(
      { subtype: 'kanban_query', create: input.parent === undefined ? {} : { parent: input.parent } },
      SDKControlKanbanQueryResponseSchema(),
    )
    if (!approval) return { behavior: 'allow', updatedInput: input }
    if (approval === 'board') {
      return {
        behavior: 'ask',
        message: `Create the project board with the card "${input.title}"?`,
        updatedInput: input,
        decisionReason: { type: 'safetyCheck', reason: KANBAN_BOARD_PERMISSION_REASON, classifierApprovable: false },
      }
    }
    return {
      behavior: 'ask',
      message: `Add the card "${input.title}" to the project board?`,
      updatedInput: input,
      decisionReason: { type: 'other', reason: KANBAN_CARD_PERMISSION_REASON },
    }
  },
  renderToolUseMessage(input) {
    return input.title ?? null
  },
  async call(card) {
    const created = await requestHost({ subtype: 'kanban_command', command: { type: 'create_card', ...card } }, SDKControlKanbanCommandResponseSchema())
    return { data: created }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: jsonStringify(output) }
  },
} satisfies ToolDef<InputSchema, Output>)
