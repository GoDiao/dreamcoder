import { dirname, join } from 'node:path'
import { z } from 'zod/v4'
import { getSessionId } from '../../bootstrap/state.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticArray } from '../../utils/semanticArray.js'
import { getTranscriptPath } from '../../utils/sessionStorage.js'
import {
  changeUiPage,
  createUiPage,
  describeUiPageKinds,
  kindsUsed,
  listUiPageComponents,
  readLatestUiPage,
  uiPageBlocks,
  UiPageError,
  type UiPageOperation,
  type UiPageRevision,
} from '../../utils/uiPages.js'
import { SHOW_UI_ENABLED_ENV, SHOW_UI_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const jsonObject = z.record(z.string(), z.unknown())

const inputSchema = lazySchema(() =>
  z.strictObject({
    title: z.string().optional().describe('Short page title. Required when creating a page.'),
    blocks: semanticArray(
      z.array(z.strictObject({ kind: z.string().min(1), data: jsonObject })).min(1).max(100).optional(),
    ).describe('The page content in reading order. Required when creating a page.'),
    pageId: z.string().optional().describe('The page to read or change. Omit to create a new page.'),
    baseRevision: z.number().int().min(1).optional().describe('The latest revision of the page. Required with operations.'),
    operations: semanticArray(z.array(jsonObject).min(1).max(1000).optional()).describe(
      'Changes by block id, applied together as the next revision.',
    ),
    catalog: z.literal(true).optional().describe('List every component with a short description.'),
    describe: z
      .array(z.string().min(1))
      .min(1)
      .max(20)
      .optional()
      .describe('Component kinds whose data formats and examples to return.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    pageId: z.string().optional(),
    revision: z.number().optional(),
    title: z.string().optional(),
    blocks: z.array(z.object({ id: z.string(), kind: z.string(), component: z.boolean() })).optional(),
    page: z.unknown().optional(),
    note: z.string().optional(),
    components: z.array(z.unknown()).optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

type Input = z.infer<InputSchema>
type ShowUiForm = 'create' | 'change' | 'read' | 'catalog' | 'describe'

export const COMPONENT_DOCS_LANGUAGE_NOTE =
  'The component documentation below is written in Chinese. That says nothing about the user: write the page and your reply in the language of the user\'s messages.'

type ComponentGuidance = { catalog: boolean; kinds: Set<string> }

const guidanceBySession = new Map<string, ComponentGuidance>()

export function sessionGuidance(sessionId: string): ComponentGuidance {
  let guidance = guidanceBySession.get(sessionId)
  if (!guidance) {
    guidance = { catalog: false, kinds: new Set() }
    guidanceBySession.set(sessionId, guidance)
  }
  return guidance
}

export function guidanceProblem(input: Input, guidance: ComponentGuidance): string | null {
  const form = showUiForm(input)
  if (form !== 'create' && form !== 'change') return null
  if (form === 'create' && !guidance.catalog) {
    return 'Before creating a page, list the components with ShowUI({ catalog: true }) and pick the ones that show the content best. Nothing was saved.'
  }
  const unread = kindsUsed({ blocks: input.blocks, operations: input.operations as UiPageOperation[] | undefined })
    .filter((kind) => kind !== 'text' && !guidance.kinds.has(kind))
  if (unread.length === 0) return null
  return `Read the data format of ${unread.join(', ')} first with ShowUI({ describe: ${JSON.stringify(unread)} }), then retry. Nothing was saved.`
}

export function getSessionDataDir(): string {
  return join(dirname(getTranscriptPath()), getSessionId())
}

export function showUiForm(input: Input): ShowUiForm | null {
  const given = (Object.keys(input) as (keyof Input)[]).filter((key) => input[key] !== undefined).sort().join(',')
  if (given === 'catalog') return 'catalog'
  if (given === 'describe') return 'describe'
  if (given === 'pageId') return 'read'
  if (given === 'blocks,title') return 'create'
  if (given === 'baseRevision,operations,pageId') return 'change'
  return null
}

export function showUiInputProblem(input: Input): string | null {
  return showUiForm(input)
    ? null
    : 'Use exactly one form: { catalog: true } to list components, { describe: [kinds] } for their formats, { title, blocks } to create, { pageId, baseRevision, operations } to change, or { pageId } to read.'
}

export async function applyShowUiInput(sessionDir: string, input: Input): Promise<UiPageRevision> {
  const form = showUiForm(input)
  if (form === 'read') return readLatestUiPage(sessionDir, input.pageId!)
  if (form === 'create') return createUiPage(sessionDir, { title: input.title!, blocks: input.blocks! })
  if (form === 'change') {
    return changeUiPage(sessionDir, {
      pageId: input.pageId!,
      baseRevision: input.baseRevision!,
      operations: input.operations as UiPageOperation[],
    })
  }
  throw new UiPageError('invalid_page', showUiInputProblem(input) ?? 'Unsupported input.')
}

export function showUiOutput(input: Input, page: UiPageRevision): Output {
  const summary = { pageId: page.pageId, revision: page.revision, title: page.title }
  return showUiForm(input) === 'read'
    ? { ...summary, page: page.artifact.document }
    : { ...summary, blocks: uiPageBlocks(page.artifact.document) }
}

export const ShowUITool = buildTool({
  name: SHOW_UI_TOOL_NAME,
  searchHint: 'show an interactive page with charts, tables and diagrams inline',
  maxResultSizeChars: Infinity,
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
    return SHOW_UI_TOOL_NAME
  },
  isEnabled() {
    return isEnvTruthy(process.env[SHOW_UI_ENABLED_ENV])
  },
  toAutoClassifierInput(input) {
    return input.title ?? input.pageId ?? input.describe?.join(', ') ?? ''
  },
  async validateInput(input) {
    const problem = showUiInputProblem(input) ?? guidanceProblem(input, sessionGuidance(getSessionId()))
    return problem ? { result: false, message: problem, errorCode: 1 } : { result: true }
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage() {
    return null
  },
  async call(input) {
    try {
      const form = showUiForm(input)
      const guidance = sessionGuidance(getSessionId())
      if (form === 'catalog') {
        guidance.catalog = true
        return { data: { note: COMPONENT_DOCS_LANGUAGE_NOTE, components: await listUiPageComponents() } }
      }
      if (form === 'describe') {
        const components = await describeUiPageKinds(input.describe!)
        for (const kind of input.describe!) guidance.kinds.add(kind)
        return { data: { note: COMPONENT_DOCS_LANGUAGE_NOTE, components } }
      }
      return { data: showUiOutput(input, await applyShowUiInput(getSessionDataDir(), input)) }
    } catch (error) {
      if (error instanceof UiPageError) throw new Error(error.message)
      throw error
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(output),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
