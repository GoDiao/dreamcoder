import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { checkArtifact } from '../../utils/artifactCheck.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { ARTIFACT_CHECK_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    path: z.string().min(1).describe('The artifact folder (dc_artifacts/<name>) or its artifact.json.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => z.object({ problems: z.array(z.string()) }))
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const ArtifactCheckTool = buildTool({
  name: ARTIFACT_CHECK_TOOL_NAME,
  searchHint: 'check an artifact for problems before showing it',
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
    return ARTIFACT_CHECK_TOOL_NAME
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.path
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage() {
    return null
  },
  async call(input) {
    return { data: { problems: await checkArtifact(expandPath(input.path)) } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.problems.length === 0 ? 'No problems found.' : output.problems.map(problem => `- ${problem}`).join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
