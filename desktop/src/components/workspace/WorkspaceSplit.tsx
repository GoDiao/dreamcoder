import { lazy, Suspense, type ReactNode } from 'react'
import { usePanelWidthPersistence } from '../../hooks/usePanelWidthPersistence'
import { useViewportQuery } from '../../hooks/useMobileViewport'
import { useTitleRow } from '../../hooks/useTitleRow'
import { useTranslation } from '../../i18n'
import {
  WORKSPACE_PANEL_MAX_WIDTH,
  WORKSPACE_PANEL_MIN_CHAT_WIDTH,
  WORKSPACE_PANEL_MIN_WIDTH,
  useWorkspacePanelStore,
} from '../../stores/workspacePanelStore'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../shared/ui/resizable'
import { Spinner } from '../shared/ui/spinner'
import type { WorkspacePanelProps } from './WorkspacePanel'

const WorkspacePanel = lazy(() => import('./WorkspacePanel').then((m) => ({ default: m.WorkspacePanel })))

const SIDE_PANEL_CLASS = [
  'relative flex border-l border-[var(--color-border)] bg-[var(--color-surface)]',
  'max-[850px]:absolute max-[850px]:inset-y-0 max-[850px]:right-0 max-[850px]:z-20',
  'max-[850px]:w-[min(380px,100%)]! max-[850px]:max-w-full max-[850px]:shadow-[var(--shadow-dropdown)]',
].join(' ')

export function useWorkspaceSplitState(panelId: string | null, enabled: boolean) {
  const showPanel = useWorkspacePanelStore((state) => enabled && panelId ? state.isPanelOpen(panelId) : false)
  const panelExpanded = useWorkspacePanelStore((state) => showPanel && panelId ? state.isPanelExpanded(panelId) : false)
  return { showPanel, panelExpanded }
}

type Props = {
  showPanel: boolean
  panelExpanded: boolean
  panel: Omit<WorkspacePanelProps, 'titleRowStyle' | 'titleRowClass'>
  testId: string
  children: ReactNode
}

export function WorkspaceSplit({ showPanel, panelExpanded, panel, testId, children }: Props) {
  const t = useTranslation()
  const useOverlayPanel = useViewportQuery('(width < 850px)')
  const setPanelWidth = useWorkspacePanelStore((state) => state.setWidth)
  const panelWidth = useWorkspacePanelStore((state) => state.width)
  const { panelRef, onLayoutChanged } = usePanelWidthPersistence(setPanelWidth, showPanel && !panelExpanded && !useOverlayPanel)
  const { style: titleRowStyle, className: titleRowClass } = useTitleRow()

  return (
    <ResizablePanelGroup orientation="horizontal" data-testid={testId} className="relative min-h-0 min-w-0 flex-1" onLayoutChanged={onLayoutChanged}>
      <ResizablePanel id="main-panel" minSize={panelExpanded || useOverlayPanel ? 0 : showPanel ? WORKSPACE_PANEL_MIN_CHAT_WIDTH : 0} maxSize={panelExpanded ? 0 : undefined} className="flex min-h-0">
        {children}
      </ResizablePanel>
      {showPanel && !panelExpanded && !useOverlayPanel ? <ResizableHandle aria-label={t('workspace.resizePanel')} data-testid="workspace-resize-handle" className="w-1.5" /> : null}
      {showPanel ? (
        <ResizablePanel id="workspace-panel" panelRef={panelRef} groupResizeBehavior="preserve-pixel-size"
          defaultSize={panelExpanded ? '100%' : useOverlayPanel ? 0 : panelWidth}
          minSize={panelExpanded || useOverlayPanel ? 0 : WORKSPACE_PANEL_MIN_WIDTH}
          maxSize={panelExpanded ? '100%' : useOverlayPanel ? 0 : WORKSPACE_PANEL_MAX_WIDTH}
          data-testid="session-side-panel"
          className={panelExpanded ? 'flex min-w-0' : SIDE_PANEL_CLASS}
        >
          <Suspense
            fallback={
              <div
                role="status"
                aria-label={t('common.loading')}
                className="flex h-full min-h-0 w-full min-w-0 items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-tertiary)]"
              >
                <Spinner aria-hidden="true" />
              </div>
            }
          >
            <WorkspacePanel {...panel} titleRowStyle={titleRowStyle(panelExpanded)} titleRowClass={titleRowClass} />
          </Suspense>
        </ResizablePanel>
      ) : null}
    </ResizablePanelGroup>
  )
}
