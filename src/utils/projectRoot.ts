import { realpath } from 'node:fs/promises'
import * as path from 'node:path'
import { findCanonicalGitRoot } from './git.js'
import { normalizeDriveRootPathForPlatform } from './windowsDrivePath.js'

const WORKTREES_MARKER = `${path.sep}.claude${path.sep}worktrees${path.sep}`

async function canonicalizeProjectPath(projectPath: string): Promise<string> {
  try {
    return normalizeDriveRootPathForPlatform(await realpath(projectPath)).normalize('NFC')
  } catch {
    return projectPath.normalize('NFC')
  }
}

export async function resolveProjectRoot(candidate: string): Promise<string> {
  const canonical = await canonicalizeProjectPath(candidate)
  const gitRoot = findCanonicalGitRoot(canonical)
  if (gitRoot) return gitRoot
  const markerIndex = canonical.indexOf(WORKTREES_MARKER)
  return markerIndex > 0 ? canonical.slice(0, markerIndex) : canonical
}
