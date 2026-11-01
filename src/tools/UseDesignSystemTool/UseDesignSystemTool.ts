import { join } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { ARTIFACTS_DIRNAME } from '../../utils/artifacts.js'
import { getArtifactWorkRoot } from '../../utils/cwd.js'
import {
  DESIGN_SYSTEM_MANIFEST_FILE,
  designSystemUsage,
  findDesignSystem,
  installDesignSystem,
  readDesignSystemCatalog,
} from '../../utils/designSystems.js'
import { errorMessage } from '../../utils/errors.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { announceArtifactWrite } from '../../utils/worktree.js'
import { USE_DESIGN_SYSTEM_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    id: z.string().min(1).describe('Design system id from the library index.'),
    name: z.string().min(1).optional().describe('Folder name inside dc_artifacts/systems/. Defaults to the id.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({ name: z.string(), path: z.string(), reused: z.boolean(), usage: z.string() }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const UseDesignSystemTool = buildTool({
  name: USE_DESIGN_SYSTEM_TOOL_NAME,
  searchHint: 'copy a bundled design system into this project so an artifact can use its tokens',
  maxResultSizeChars: 5_000,
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
    return USE_DESIGN_SYSTEM_TOOL_NAME
  },
  isReadOnly() {
    return false
  },
  isConcurrencySafe() {
    return false
  },
  toAutoClassifierInput(input) {
    return input.id
  },
  async validateInput(input) {
    let known: string[]
    try {
      known = (await readDesignSystemCatalog()).systems.map(system => system.id)
    } catch (error) {
      return { result: false, message: `The design system library is not available: ${errorMessage(error)}`, errorCode: 1 }
    }
    if (!known.includes(input.id)) {
      return { result: false, message: `Unknown design system id: ${input.id}. Use an id from the library index.`, errorCode: 2 }
    }
    return { result: true }
  },
  async checkPermissions(input) {
    const record = await findDesignSystem(input.id).catch(() => null)
    return {
      behavior: 'ask',
      message: `Copy the design system "${record?.name.en ?? input.id}" into ${join(getArtifactWorkRoot(), ARTIFACTS_DIRNAME, 'systems')}?`,
      updatedInput: input,
    }
  },
  renderToolUseMessage(input) {
    return input.id ?? null
  },
  async call(input) {
    const workRoot = getArtifactWorkRoot()
    try {
      const installed = await installDesignSystem({
        systemId: input.id,
        artifactsDir: join(workRoot, ARTIFACTS_DIRNAME),
        name: input.name,
      })
      await announceArtifactWrite(workRoot, join(installed.dir, DESIGN_SYSTEM_MANIFEST_FILE), USE_DESIGN_SYSTEM_TOOL_NAME)
      return {
        data: {
          name: installed.name,
          path: installed.dir,
          reused: installed.reused,
          usage: designSystemUsage(installed.name, installed.dir),
        },
      }
    } catch (error) {
      throw new Error(`Could not copy the design system: ${errorMessage(error)}. Nothing was created.`)
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const lead = output.reused
      ? `The design system is already in this project at ${output.path}; that copy is used as it is.`
      : `Copied the design system to ${output.path}.`
    return { tool_use_id: toolUseID, type: 'tool_result', content: `${lead}\n${output.usage}` }
  },
} satisfies ToolDef<InputSchema, Output>)
