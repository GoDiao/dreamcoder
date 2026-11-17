import { SDKControlArtifactEditWaitResponseSchema } from '../entrypoints/sdk/controlSchemas.js'
import { artifactFolderContaining } from './artifacts.js'
import { isEnvTruthy } from './envUtils.js'
import { hasHostRequester, requestHost } from './hostRequests.js'

export const ARTIFACT_EDIT_WAIT_SUBTYPE = 'artifact_edit_wait'
export const ARTIFACT_EDIT_LOCKS_ENV = 'DREAMCODER_ARTIFACT_EDIT_LOCKS'

export async function waitWhileUserEditsArtifact(filePath: string, signal: AbortSignal): Promise<{ folder: string; files: string[] } | null> {
  const folder = artifactFolderContaining(filePath)
  if (!folder || !isEnvTruthy(process.env[ARTIFACT_EDIT_LOCKS_ENV]) || !hasHostRequester()) return null
  const { files } = await requestHost({ subtype: ARTIFACT_EDIT_WAIT_SUBTYPE, path: filePath }, SDKControlArtifactEditWaitResponseSchema(), signal)
  return { folder, files }
}

export async function refuseWriteAfterUserEdits(filePath: string, signal: AbortSignal): Promise<void> {
  const edits = await waitWhileUserEditsArtifact(filePath, signal)
  if (!edits || edits.files.length === 0) return
  throw new Error(`The user was editing the artifact ${edits.folder} in the app while you waited, and changed ${edits.files.join(', ')} there. Read those files, keep the user's changes, then make your change again.`)
}
