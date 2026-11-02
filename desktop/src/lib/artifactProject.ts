import type { ArtifactListItem } from '../types/artifact'
import { getFileNameFromPath } from './composerAttachments'

export function artifactProjectKey(item: Pick<ArtifactListItem, 'projectRoot' | 'origin'>) {
  return item.projectRoot ?? item.origin?.projectRoot ?? ''
}

export function artifactProjectName(item: Pick<ArtifactListItem, 'projectRoot' | 'origin'>) {
  return getFileNameFromPath(artifactProjectKey(item))
}

function artifactSortTime(item: Pick<ArtifactListItem, 'lastOpenedAt' | 'latestMtimeMs'>) {
  return item.lastOpenedAt ?? item.latestMtimeMs
}

export function sortArtifacts<T extends Pick<ArtifactListItem, 'lastOpenedAt' | 'latestMtimeMs'>>(items: readonly T[]) {
  return [...items].sort((a, b) => artifactSortTime(b) - artifactSortTime(a))
}
