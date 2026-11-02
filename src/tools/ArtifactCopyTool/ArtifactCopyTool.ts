import { join, resolve } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { copyArtifactFolder } from '../../utils/artifactTransfer.js'
import {
  ARTIFACTS_DIRNAME,
  ARTIFACT_MANIFEST_FILE,
  artifactNameOf,
  artifactsDirOf,
  isGlobalArtifactsPath,
  isSafeArtifactName,
} from '../../utils/artifacts.js'
import { directoryExists } from '../../utils/bundledContent.js'
import { getArtifactWorkRoot } from '../../utils/cwd.js'
import { errorMessage } from '../../utils/errors.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { announceArtifactWrite } from '../../utils/worktree.js'
import { ARTIFACT_COPY_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    path: z.string().min(1).describe('The artifact folder to copy (.../dc_artifacts/<name>).'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({ name: z.string(), path: z.string(), movedFromGlobalStore: z.boolean() }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function artifactFolderOf(path: string): { folder: string; name: string } | null {
  const artifactsDir = artifactsDirOf(path)
  const name = artifactNameOf(path)
  if (!artifactsDir || !name || !isSafeArtifactName(name)) return null
  const folder = join(artifactsDir, name)
  return resolve(path) === folder ? { folder, name } : null
}

export const ArtifactCopyTool = buildTool({
  name: ARTIFACT_COPY_TOOL_NAME,
  searchHint: 'copy an artifact into this project so it can be edited',
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
    return ARTIFACT_COPY_TOOL_NAME
  },
  toAutoClassifierInput(input) {
    return input.path
  },
  async validateInput(input) {
    const target = artifactFolderOf(expandPath(input.path))
    if (!target) {
      return { result: false, message: `${input.path} is not an artifact folder (expected .../dc_artifacts/<name>).`, errorCode: 1 }
    }
    if (artifactsDirOf(target.folder) === resolve(getArtifactWorkRoot(), ARTIFACTS_DIRNAME)) {
      return { result: false, message: 'That artifact is already in this directory. Edit it in place.', errorCode: 2 }
    }
    if (!(await directoryExists(target.folder))) {
      return {
        result: false,
        message: 'That artifact has been moved or deleted. If its working directory was removed it may now be in the global store: look in the dc_artifacts folder of the global store.',
        errorCode: 3,
      }
    }
    return { result: true }
  },
  async checkPermissions(input) {
    const target = artifactFolderOf(expandPath(input.path))
    return {
      behavior: 'ask',
      message: `Copy the artifact "${target?.name ?? input.path}" into ${join(getArtifactWorkRoot(), ARTIFACTS_DIRNAME)}?`,
      updatedInput: input,
    }
  },
  renderToolUseMessage(input) {
    return input.path ?? null
  },
  async call(input) {
    const target = artifactFolderOf(expandPath(input.path))!
    const fromGlobalStore = isGlobalArtifactsPath(target.folder)
    try {
      const copied = await copyArtifactFolder({
        source: target.folder,
        destArtifactsDir: join(getArtifactWorkRoot(), ARTIFACTS_DIRNAME),
        removeSource: fromGlobalStore,
      })
      await announceArtifactWrite(getArtifactWorkRoot(), join(copied.dir, ARTIFACT_MANIFEST_FILE), ARTIFACT_COPY_TOOL_NAME)
      return { data: { name: copied.name, path: copied.dir, movedFromGlobalStore: fromGlobalStore } }
    } catch (error) {
      throw new Error(`Could not copy the artifact: ${errorMessage(error)}. The original was left as it was.`)
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Copied the artifact to ${output.path}${output.movedFromGlobalStore ? ' and removed it from the global store' : ''}. Edit the copy there.`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
