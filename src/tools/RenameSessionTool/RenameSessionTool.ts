import { z } from 'zod/v4'
import {
  SDKControlSessionRenameResponseSchema,
  type SDKControlSessionRenameResponse,
} from '../../entrypoints/sdk/controlSchemas.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { requestHost } from '../../utils/hostRequests.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { isSessionLinksEnabled } from '../StartSessionTool/constants.js'
import { RENAME_SESSION_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    title: z.string().min(1).describe('The new title of this session.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => SDKControlSessionRenameResponseSchema())
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = SDKControlSessionRenameResponse

export const RenameSessionTool = buildTool({
  name: RENAME_SESSION_TOOL_NAME,
  searchHint: 'rename this session, change the session title',
  maxResultSizeChars: 1_000,
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
    return RENAME_SESSION_TOOL_NAME
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
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage(input) {
    return input.title ?? null
  },
  async call(input) {
    const renamed = await requestHost(
      { subtype: 'session_rename', title: input.title },
      SDKControlSessionRenameResponseSchema(),
    )
    return { data: renamed }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Renamed this session to "${output.title}".`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
