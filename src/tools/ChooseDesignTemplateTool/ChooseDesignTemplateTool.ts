import { join } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { ARTIFACTS_DIRNAME, ARTIFACT_MANIFEST_FILE } from '../../utils/artifacts.js'
import { getArtifactWorkRoot } from '../../utils/cwd.js'
import {
  createArtifactFromTemplate,
  designTemplateGuidance,
  findDesignTemplate,
  readDesignTemplateCatalog,
} from '../../utils/designTemplates.js'
import { errorMessage } from '../../utils/errors.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { announceArtifactWrite } from '../../utils/worktree.js'
import { CHOOSE_DESIGN_TEMPLATE_TOOL_NAME, SCRATCH_CHOICE } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    candidates: z
      .array(
        z.strictObject({
          id: z.string().min(1).describe('Template id from the template index.'),
          reason: z.string().min(1).describe('One sentence on why this template fits what the user told you.'),
        }),
      )
      .min(2)
      .max(4)
      .describe('The templates to offer, 2 to 4.'),
    name: z.string().min(1).optional().describe('Folder name of the new artifact.'),
    title: z.string().min(1).optional().describe('Title of the new artifact.'),
    choice: z.string().optional().describe('Filled in by the app with the template the user picked. Never set this.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    choice: z.string(),
    name: z.string().optional(),
    path: z.string().optional(),
    guidance: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const ChooseDesignTemplateTool = buildTool({
  name: CHOOSE_DESIGN_TEMPLATE_TOOL_NAME,
  searchHint: 'offer design templates to the user and create an artifact from the one they pick',
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
    return CHOOSE_DESIGN_TEMPLATE_TOOL_NAME
  },
  isReadOnly() {
    return false
  },
  isConcurrencySafe() {
    return false
  },
  requiresUserInteraction() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.candidates.map(candidate => candidate.id).join(' | ')
  },
  async validateInput(input) {
    const ids = input.candidates.map(candidate => candidate.id)
    if (new Set(ids).size !== ids.length) {
      return { result: false, message: 'Each template can be offered once.', errorCode: 1 }
    }
    let known: string[]
    try {
      known = (await readDesignTemplateCatalog()).templates.map(template => template.id)
    } catch (error) {
      return { result: false, message: `The template catalog is not available: ${errorMessage(error)}`, errorCode: 2 }
    }
    const unknown = ids.filter(id => !known.includes(id))
    if (unknown.length > 0) {
      return { result: false, message: `Unknown template id: ${unknown.join(', ')}. Use an id from the template index.`, errorCode: 3 }
    }
    return { result: true }
  },
  async checkPermissions(input) {
    return {
      behavior: 'ask',
      message: 'Choose a design template',
      updatedInput: input,
    }
  },
  renderToolUseMessage(input) {
    return input.candidates?.map(candidate => candidate.id).join(', ') ?? null
  },
  async call(input) {
    const { choice } = input
    if (!choice) throw new Error('The user did not choose a template.')
    if (choice === SCRATCH_CHOICE) return { data: { choice } }
    if (!input.candidates.some(candidate => candidate.id === choice)) {
      throw new Error(`"${choice}" is not one of the offered templates.`)
    }
    const workRoot = getArtifactWorkRoot()
    try {
      const created = await createArtifactFromTemplate({
        templateId: choice,
        artifactsDir: join(workRoot, ARTIFACTS_DIRNAME),
        name: input.name,
        title: input.title,
      })
      await announceArtifactWrite(workRoot, join(created.dir, ARTIFACT_MANIFEST_FILE), CHOOSE_DESIGN_TEMPLATE_TOOL_NAME)
      const template = await findDesignTemplate(choice)
      return {
        data: {
          choice,
          name: created.name,
          path: created.dir,
          ...(template && { guidance: designTemplateGuidance(template) }),
        },
      }
    } catch (error) {
      throw new Error(`Could not create the artifact from the template: ${errorMessage(error)}. Nothing was created.`)
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const content =
      output.choice === SCRATCH_CHOICE
        ? `The user chose to start from scratch (${SCRATCH_CHOICE}). Write the artifact yourself.`
        : `The user chose the template "${output.choice}". The artifact is at ${output.path}.\n${output.guidance ?? ''}`.trim()
    return { tool_use_id: toolUseID, type: 'tool_result', content }
  },
} satisfies ToolDef<InputSchema, Output>)
