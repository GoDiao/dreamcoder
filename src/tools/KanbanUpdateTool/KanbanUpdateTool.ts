import { z } from 'zod/v4'
import {
  KanbanAgentUpdateCommandSchema,
  SDKControlKanbanCommandResponseSchema,
  SDKControlKanbanQueryResponseSchema,
  SDKControlSessionListResponseSchema,
  type SDKControlKanbanCommandResponse,
} from '../../entrypoints/sdk/controlSchemas.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { requestHost } from '../../utils/hostRequests.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { KANBAN_UPDATE_TOOL_NAME } from '../KanbanListTool/constants.js'
import { isSessionLinksEnabled } from '../StartSessionTool/constants.js'
import { DESCRIPTION, KANBAN_ACCEPTANCE_PERMISSION_REASON, KANBAN_ASSIGN_PERMISSION_REASON, KANBAN_CANCEL_PERMISSION_REASON, KANBAN_REVIEWER_PERMISSION_REASON, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: KanbanAgentUpdateCommandSchema().describe('The command to apply, chosen by its type.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => SDKControlKanbanCommandResponseSchema())
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = SDKControlKanbanCommandResponse

function describe(command: { type?: string; card?: number } | undefined): string | null {
  if (!command?.type) return null
  return command.card === undefined ? command.type : `${command.type} #${command.card}`
}

async function isChildSession(sessionId: string): Promise<boolean> {
  const { sessions } = await requestHost({ subtype: 'session_list' }, SDKControlSessionListResponseSchema())
  return sessions.some((session) => session.sessionId === sessionId && session.relation === 'child')
}

async function myRoles(card: number): Promise<unknown[]> {
  const found = await requestHost({ subtype: 'kanban_query', card }, SDKControlKanbanQueryResponseSchema())
  const roles = found.card?.myRoles
  return Array.isArray(roles) ? roles : []
}

async function reviewerNeedsUser(command: { card: number; target: 'self' | { sessionId: string } }): Promise<boolean> {
  if (command.target === 'self') return true
  const roles = await myRoles(command.card)
  return roles.includes('creator') && roles.includes('owner')
}

export const KanbanUpdateTool = buildTool({
  name: KANBAN_UPDATE_TOOL_NAME,
  searchHint: 'update progress, block, submit or review a project board card',
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
    return KANBAN_UPDATE_TOOL_NAME
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
    return describe(input.command) ?? ''
  },
  async checkPermissions(input) {
    const { command } = input
    if (command.type === 'cancel') {
      return {
        behavior: 'ask',
        message: `Cancel card #${command.card}?`,
        updatedInput: input,
        decisionReason: { type: 'safetyCheck', reason: KANBAN_CANCEL_PERMISSION_REASON, classifierApprovable: false },
      }
    }
    if (command.type === 'edit_card' && command.acceptance !== undefined && !(await myRoles(command.card)).includes('creator')) {
      return {
        behavior: 'ask',
        message: `Change the acceptance criteria of card #${command.card}?`,
        updatedInput: input,
        decisionReason: { type: 'safetyCheck', reason: KANBAN_ACCEPTANCE_PERMISSION_REASON, classifierApprovable: false },
      }
    }
    if (command.type !== 'assign') return { behavior: 'allow', updatedInput: input }
    const target = command.target === 'self' ? 'this session' : `session ${command.target.sessionId}`
    const message = `Make ${target} the ${command.role} of card #${command.card}?`
    if (command.role === 'reviewer' && (await reviewerNeedsUser(command))) {
      return {
        behavior: 'ask',
        message,
        updatedInput: input,
        decisionReason: { type: 'safetyCheck', reason: KANBAN_REVIEWER_PERMISSION_REASON, classifierApprovable: false },
      }
    }
    if (command.target !== 'self' && (await isChildSession(command.target.sessionId))) {
      return { behavior: 'allow', updatedInput: input }
    }
    return {
      behavior: 'ask',
      message,
      updatedInput: input,
      decisionReason: { type: 'other', reason: KANBAN_ASSIGN_PERMISSION_REASON },
    }
  },
  renderToolUseMessage(input) {
    return describe(input.command)
  },
  async call(input) {
    const updated = await requestHost(
      { subtype: 'kanban_command', command: input.command },
      SDKControlKanbanCommandResponseSchema(),
    )
    return { data: updated }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: jsonStringify(output) }
  },
} satisfies ToolDef<InputSchema, Output>)
