import type { TranslationKey, useTranslation } from '../i18n'
import type { ArtifactListItem } from '../types/artifact'
import { GLOBAL_ARTIFACTS_ROOT } from './artifactRoots'

const KIND_LABELS: Record<string, TranslationKey> = {
  page: 'artifacts.kind.page',
  canvas: 'artifacts.kind.canvas',
}

export function artifactDetail(t: ReturnType<typeof useTranslation>, item: Pick<ArtifactListItem, 'error' | 'entryMissing' | 'manifest'>): string {
  if (item.error) return t('artifacts.invalidManifest', { reason: item.error })
  if (item.entryMissing) return t('artifacts.entryMissing')
  const kind = item.manifest?.kind
  return kind ? t(KIND_LABELS[kind]!) : ''
}

export function artifactTitle(item: Pick<ArtifactListItem, 'manifest' | 'name'>): string {
  return item.manifest?.title ?? item.name
}

export function artifactKey(item: Pick<ArtifactListItem, 'artifactsDir' | 'name'>): string {
  return `${item.artifactsDir}\u0000${item.name}`
}

export function artifactOpenable(item: Pick<ArtifactListItem, 'manifest' | 'entryMissing'>): boolean {
  return item.manifest !== null && !item.entryMissing
}

export function artifactBranch(item: Pick<ArtifactListItem, 'branch' | 'origin'>): string | null {
  return item.branch ?? item.origin?.branch ?? null
}

export function artifactRoot(item: Pick<ArtifactListItem, 'workDir' | 'artifactsDir'>): string {
  return item.workDir === null ? GLOBAL_ARTIFACTS_ROOT : item.artifactsDir
}
