export type ArtifactKind = 'page' | 'canvas'

export type ArtifactManifest = {
  version: 1
  id: string
  kind: ArtifactKind
  title: string
  entry: string
  designSystem?: string
  template?: { id: string; commit: string }
}

export type ArtifactOrigin = {
  workDir: string | null
  projectRoot: string | null
  branch: string | null
}

export type ArtifactSessionMark = { sessionId: string; source: 'tool' | 'snapshot' }

export type ArtifactListItem = {
  name: string
  artifactsDir: string
  dir: string
  workDir: string | null
  projectRoot: string | null
  branch: string | null
  id: string | null
  lastOpenedAt: number | null
  entryMissing: boolean
  thumbnailMtimeMs: number | null
  origin: ArtifactOrigin | null
  sessions: ArtifactSessionMark[]
  manifest: ArtifactManifest | null
  error: string | null
  latestMtimeMs: number
}

export type ArtifactOpenTarget = {
  rootDir: string
  filePath: string
}

export type ArtifactCopyResult = {
  id: string
  name: string
  artifactsDir: string
  dir: string
}

export type DesignSystemManifest = {
  version: 1
  name: string
  source: 'bundled' | 'extracted'
  license: string
  author: string
  libraryId?: string
}

export type DesignSystemListItem = {
  name: string
  dir: string
  artifactsDir: string
  workDir: string | null
  manifest: DesignSystemManifest | null
  error: string | null
}

export type WorkspaceArtifactsResult = {
  current: ArtifactListItem[]
  others: ArtifactListItem[]
  systems: { current: DesignSystemListItem[]; others: DesignSystemListItem[] }
}
