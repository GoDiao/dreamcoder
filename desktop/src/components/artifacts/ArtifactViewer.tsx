import { Download, MessageSquarePlus, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { artifactsApi } from '../../api/artifacts'
import { useArtifactExportActions } from '../../hooks/useArtifactExportActions'
import { useArtifactThumbnail } from '../../hooks/useArtifactThumbnail'
import { useCanvasTab } from '../../hooks/useCanvasTab'
import { useStandaloneBrowserPage } from '../../hooks/useStandaloneBrowserPage'
import { useTranslation } from '../../i18n'
import { browserReload } from '../../lib/browserGuests'
import { continueArtifactInNewSession, continueArtifactInSession } from '../../lib/continueArtifactInSession'
import { errorMessage } from '../../lib/errorMessage'
import { artifactRoot } from '../../lib/artifactDisplay'
import { artifactProjectKey } from '../../lib/artifactProject'
import { useArtifactListStore } from '../../stores/artifactListStore'
import { useArtifactViewStore, type ViewedArtifact } from '../../stores/artifactViewStore'
import { useSessionStore } from '../../stores/sessionStore'
import { ActionMenu, type MenuAction } from '../shared/ActionMenu'
import { Button } from '../shared/ui/button'
import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { ViewerHeader } from '../shared/ViewerHeader'

export const ARTIFACT_VIEW_TAB = '__artifact-view-tab__'
const MENU_SESSION_LIMIT = 8

export function ArtifactViewer({ viewing }: { viewing: ViewedArtifact }) {
  const t = useTranslation()
  const close = useArtifactViewStore((state) => state.close)
  const sessions = useSessionStore((state) => state.sessions)
  const item = useArtifactListStore((state) => state.items.find((candidate) => candidate.id === viewing.id))
  useArtifactThumbnail(ARTIFACT_VIEW_TAB, item?.id ? { id: item.id, mtimeMs: item.latestMtimeMs } : undefined)
  const stageRef = useStandaloneBrowserPage(
    ARTIFACT_VIEW_TAB,
    viewing.id,
    () => artifactsApi.openById(viewing.id),
    () => artifactsApi.markOpened(viewing.id),
  )
  useCanvasTab(item ? { tabId: ARTIFACT_VIEW_TAB, sessionId: null, root: artifactRoot(item), name: item.name } : null)

  const exportActions = useArtifactExportActions({ tabId: ARTIFACT_VIEW_TAB, sessionId: null, title: viewing.title })
  const report = (error: unknown) => toast.error(errorMessage(error))
  const artifact = item ?? { id: viewing.id, manifest: null, name: viewing.name }
  const workDir = item?.workDir ?? item?.origin?.workDir ?? (item ? artifactProjectKey(item) : '')
  const actions: MenuAction[] = [
    ...(workDir
      ? [{
          id: 'new-session',
          label: t('artifactsPage.newSession'),
          onSelect: () => void continueArtifactInNewSession(artifact, workDir).catch(report),
        }]
      : []),
    ...sessions
      .filter((session) => session.workDirExists)
      .slice(0, MENU_SESSION_LIMIT)
      .map((session, index) => ({
        id: session.id,
        label: session.title,
        separatorBefore: index === 0 && workDir !== '',
        heading: index === 0 ? t('artifactsPage.existingChats') : undefined,
        onSelect: () => void continueArtifactInSession(artifact, session.id, session.title).catch(report),
      })),
  ]

  return (
    <div data-testid="artifact-viewer" className="flex min-h-0 flex-1 flex-col">
      <ViewerHeader title={viewing.title} onBack={close}>
        <HintTooltip content={t('browser.reload')}>
          <Button variant="ghost" size="icon-sm" aria-label={t('browser.reload')} onClick={() => browserReload(ARTIFACT_VIEW_TAB)}>
            <RotateCw aria-hidden="true" />
          </Button>
        </HintTooltip>
        <ActionMenu
          label={t('artifactsPage.export')}
          actions={exportActions}
          trigger={
            <Button variant="outline" size="sm">
              <Download aria-hidden="true" />
              {t('artifactsPage.export')}
            </Button>
          }
        />
        <ActionMenu
          label={t('artifactsPage.continueInSession')}
          actions={actions}
          trigger={
            <Button variant="outline" size="sm" disabled={actions.length === 0}>
              <MessageSquarePlus aria-hidden="true" />
              {t('artifactsPage.continueInSession')}
            </Button>
          }
        />
      </ViewerHeader>
      <div ref={stageRef} data-testid="artifact-viewer-stage" className="min-h-0 flex-1" />
    </div>
  )
}
