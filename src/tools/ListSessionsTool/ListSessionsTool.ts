import { z } from 'zod/v4'
import {
  SDKControlSessionListResponseSchema,
  type SDKControlSessionListResponse,
} from '../../entrypoints/sdk/controlSchemas.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { requestHost } from '../../utils/hostRequests.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { isSessionLinksEnabled } from '../StartSessionTool/constants.js'
import { LIST_SESSIONS_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    project: z.string().min(1).optional().describe('Only list sessions of this project (its folder path).'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => SDKControlSessionListResponseSchema())
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = SDKControlSessionListResponse

export const ListSessionsTool = buildTool({
  name: LIST_SESSIONS_TOOL_NAME,
  searchHint: 'list the other sessions that can be messaged',
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
    return LIST_SESSIONS_TOOL_NAME
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
    return input.project ?? ''
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage(input) {
    return input.project ?? null
  },
  async call(input) {
    const listed = await requestHost(
      {
        subtype: 'session_list',
        ...(input.project === undefined ? {} : { project: input.project }),
      },
      SDKControlSessionListResponseSchema(),
    )
    return { data: listed }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(output),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
