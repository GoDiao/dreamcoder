import { join, resolve } from 'node:path'
import { ARTIFACT_COPY_TOOL_NAME } from '../../tools/ArtifactCopyTool/constants.js'
import {
  ARTIFACTS_DIRNAME,
  artifactsDirOf,
  hasArtifactsSegment,
} from '../artifacts.js'
import { getArtifactWorkRoot } from '../cwd.js'
import type { PermissionDecisionReason, PermissionMode } from '../../types/permissions.js'
import { getPathsForPermissionCheck } from '../fsOperations.js'
import { normalizeCaseForComparison } from './filesystem.js'

const FOREIGN_DENIAL = `Artifacts outside your current working directory are read-only. Use the ${ARTIFACT_COPY_TOOL_NAME} tool to copy the artifact into this project first, then edit the copy.`

function ownArtifactsDirs(): string[] {
  return getPathsForPermissionCheck(getArtifactWorkRoot()).map(path => normalizeCaseForComparison(resolve(path, ARTIFACTS_DIRNAME)))
}

function isOwn(path: string, own: readonly string[]): boolean {
  const dir = artifactsDirOf(path)
  return dir !== null && own.includes(normalizeCaseForComparison(dir))
}

export function artifactLocationDenial(paths: readonly string[]): string | null {
  if (!paths.some(hasArtifactsSegment)) return null
  const own = ownArtifactsDirs()
  return paths.some(path => hasArtifactsSegment(path) && !isOwn(path, own)) ? FOREIGN_DENIAL : null
}

export function isOwnArtifactWrite(paths: readonly string[]): boolean {
  if (paths.length === 0 || !paths.every(hasArtifactsSegment)) return false
  const own = ownArtifactsDirs()
  return paths.every(path => isOwn(path, own))
}

export const OWN_ARTIFACT_WRITE_REASON: PermissionDecisionReason = {
  type: 'other',
  reason: 'Writing to artifacts in the working directory is allowed',
}

export function artifactDenialReason(message: string): PermissionDecisionReason {
  return { type: 'other', reason: message, hardDeny: true }
}

export function artifactDenialFor(
  paths: readonly string[],
  operationType: 'read' | 'write' | 'create',
): PermissionDecisionReason | null {
  if (operationType === 'read') return null
  const denial = artifactLocationDenial(paths)
  return denial ? artifactDenialReason(denial) : null
}

export function allowsOwnArtifactWrite(
  paths: readonly string[],
  operationType: 'read' | 'write' | 'create',
  mode: PermissionMode,
): boolean {
  return operationType !== 'read' && mode !== 'plan' && isOwnArtifactWrite(paths)
}

export function isHardDenial(reason: PermissionDecisionReason | undefined): boolean {
  return reason?.type === 'rule' || (reason?.type === 'other' && reason.hardDeny === true)
}
