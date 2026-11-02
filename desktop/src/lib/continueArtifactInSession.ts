import { artifactsApi } from '../api/artifacts'
import { artifactTitle } from './artifactDisplay'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'
import type { ArtifactListItem } from '../types/artifact'

export async function continueArtifactInSession(artifact: Pick<ArtifactListItem, 'id' | 'manifest' | 'name'>, sessionId: string, sessionTitle: string) {
  if (!artifact.id) throw new Error('This artifact has no id')
  const copied = await artifactsApi.copyInto(artifact.id, sessionId)
  useTabStore.getState().openTab(sessionId, sessionTitle)
  await useWorkspacePanelStore.getState().openArtifact(
    sessionId,
    { id: copied.id, name: copied.name, manifest: artifact.manifest, latestMtimeMs: Date.now() },
    copied.artifactsDir,
  )
  useWorkspaceChatContextStore.getState().addReference(sessionId, {
    kind: 'file',
    path: copied.dir,
    absolutePath: copied.dir,
    name: artifactTitle(artifact),
    isDirectory: true,
  })
}

export async function continueArtifactInNewSession(artifact: Pick<ArtifactListItem, 'id' | 'manifest' | 'name'>, workDir: string) {
  const sessionId = await useSessionStore.getState().createSession(workDir)
  const title = useSessionStore.getState().sessions.find((session) => session.id === sessionId)?.title ?? artifactTitle(artifact)
  await continueArtifactInSession(artifact, sessionId, title)
}
