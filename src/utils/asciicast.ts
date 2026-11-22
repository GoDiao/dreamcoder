import { rename } from 'fs/promises'
import { basename, join } from 'path'
import { getOriginalCwd, getSessionId } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getFsImplementation } from './fsOperations.js'
import { sanitizePath } from './path.js'

// Mutable recording state — filePath is updated when session ID changes (e.g., --resume)
const recordingState: { filePath: string | null; timestamp: number } = {
  filePath: null,
  timestamp: 0,
}

export function _resetRecordingStateForTesting(): void {
  recordingState.filePath = null
  recordingState.timestamp = 0
}

/**
 * Find all .cast files for the current session.
 * Returns paths sorted by filename (chronological by timestamp suffix).
 */
export function getSessionRecordingPaths(): string[] {
  const sessionId = getSessionId()
  const projectsDir = join(getClaudeConfigHomeDir(), 'projects')
  const projectDir = join(projectsDir, sanitizePath(getOriginalCwd()))
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- called during /share before upload, not in hot path
    const entries = getFsImplementation().readdirSync(projectDir)
    const names = (
      typeof entries[0] === 'string'
        ? entries
        : (entries as { name: string }[]).map(e => e.name)
    ) as string[]
    const files = names
      .filter(f => f.startsWith(sessionId) && f.endsWith('.cast'))
      .sort()
    return files.map(f => join(projectDir, f))
  } catch {
    return []
  }
}

/**
 * Rename the recording file to match the current session ID.
 * Called after --resume/--continue changes the session ID via switchSession().
 * The recorder was installed with the initial (random) session ID; this renames
 * the file so getSessionRecordingPaths() can find it by the resumed session ID.
 */
export async function renameRecordingForSession(): Promise<void> {
  const oldPath = recordingState.filePath
  if (!oldPath || recordingState.timestamp === 0) {
    return
  }
  const projectsDir = join(getClaudeConfigHomeDir(), 'projects')
  const projectDir = join(projectsDir, sanitizePath(getOriginalCwd()))
  const newPath = join(
    projectDir,
    `${getSessionId()}-${recordingState.timestamp}.cast`,
  )
  if (oldPath === newPath) {
    return
  }
  // Flush pending writes before renaming
  await recorder?.flush()
  const oldName = basename(oldPath)
  const newName = basename(newPath)
  try {
    await rename(oldPath, newPath)
    recordingState.filePath = newPath
    logForDebugging(`[asciicast] Renamed recording: ${oldName} → ${newName}`)
  } catch {
    logForDebugging(
      `[asciicast] Failed to rename recording from ${oldName} to ${newName}`,
    )
  }
}

type AsciicastRecorder = {
  flush(): Promise<void>
  dispose(): Promise<void>
}

let recorder: AsciicastRecorder | null = null

/**
 * Flush pending recording data to disk.
 * Call before reading the .cast file (e.g., during /share).
 */
export async function flushAsciicastRecorder(): Promise<void> {
  await recorder?.flush()
}
