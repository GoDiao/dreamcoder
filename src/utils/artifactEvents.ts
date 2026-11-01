import { FILE_EDIT_TOOL_NAME } from '../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../tools/NotebookEditTool/constants.js'
import { hasArtifactsSegment } from './artifacts.js'
import { expandPath } from './path.js'
import { enqueueSdkEvent } from './sdkEventQueue.js'

function writtenPathOf(toolName: string, input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const record = input as Record<string, unknown>
  const raw =
    toolName === FILE_EDIT_TOOL_NAME || toolName === FILE_WRITE_TOOL_NAME
      ? record.file_path
      : toolName === NOTEBOOK_EDIT_TOOL_NAME
        ? record.notebook_path
        : undefined
  return typeof raw === 'string' && raw !== '' ? expandPath(raw) : null
}

export function emitArtifactWrittenAt(path: string, toolName: string, agentId?: string): void {
  if (!hasArtifactsSegment(path)) return
  enqueueSdkEvent({
    type: 'system',
    subtype: 'artifact_written',
    path,
    tool_name: toolName,
    ...(agentId && { agent_id: agentId }),
  })
}

export function emitArtifactWritten(toolName: string, input: unknown, agentId?: string): void {
  const path = writtenPathOf(toolName, input)
  if (path) emitArtifactWrittenAt(path, toolName, agentId)
}
