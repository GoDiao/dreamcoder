import { useState } from 'react'
import type { UiPageSummary } from '@protocol'
import { AppWindow, ChevronRight, Maximize2, PanelRight } from 'lucide-react'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { useTranslation } from '../../i18n'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { parseUiPageResult } from '../../lib/uiPageBridge'
import { useChatStore } from '../../stores/chatStore'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../shared/ui/collapsible'
import { UiPageFrame } from './UiPageFrame'

type Props = {
  sessionId: string
  input: unknown
  result?: { content: unknown; isError: boolean } | null
}

export function uiPageOfCall(input: unknown, result: Props['result']): UiPageSummary | null {
  const writesPage = typeof input === 'object' && input !== null && ('blocks' in input || 'operations' in input)
  return writesPage && result && !result.isError ? parseUiPageResult(result.content) : null
}

export function ShowUIBlock({ sessionId, input, result }: Props) {
  const page = uiPageOfCall(input, result)
  if (!page) return null
  return <ShowUIPage sessionId={sessionId} page={page} />
}

const ENLARGED_WIDTH = 1200

function ShowUIPage({ sessionId, page }: { sessionId: string; page: UiPageSummary }) {
  const t = useTranslation()
  const [open, setOpen] = useState(page.revision === 1)
  const [enlarged, setEnlarged] = useState(false)
  const canOpenInPanel = !useMobileViewport() || isDesktopRuntime()
  const isLatest = useChatStore((s) =>
    s.sessions[sessionId]?.mirror?.uiPages?.find((candidate) => candidate.pageId === page.pageId)?.revision === page.revision,
  )
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mb-3 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)]"
      data-testid="show-ui-card"
    >
      <div className="flex items-center gap-1 pr-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="row"
            type="button"
            aria-label={open ? t('uiPage.collapse') : t('uiPage.expand')}
            className="min-w-0 flex-1 px-3 py-2"
          >
            <ChevronRight size={15} className="shrink-0 text-[var(--color-text-tertiary)] transition-transform group-data-[state=open]/button:rotate-90" aria-hidden="true" />
            <AppWindow size={15} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]">
              {t('uiPage.revision', { title: page.title, revision: page.revision })}
            </span>
            {isLatest ? (
              <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{t('uiPage.latest')}</span>
            ) : null}
          </Button>
        </CollapsibleTrigger>
        <Button variant="ghost" size="icon-sm" type="button" aria-label={t('uiPage.enlarge')} title={t('uiPage.enlarge')} onClick={() => setEnlarged(true)}>
          <Maximize2 size={14} aria-hidden="true" />
        </Button>
        {canOpenInPanel ? (
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={t('uiPage.openInPanel')}
            title={t('uiPage.openInPanel')}
            onClick={() => useWorkspacePanelStore.getState().openTab(sessionId, { kind: 'uiPage', pageId: page.pageId, revision: page.revision, title: page.title })}
          >
            <PanelRight size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <CollapsibleContent>
        <div className="border-t border-[var(--color-border)]/55">
          <UiPageFrame sessionId={sessionId} pageId={page.pageId} revision={page.revision} title={page.title} />
        </div>
      </CollapsibleContent>
      <Modal open={enlarged} onClose={() => setEnlarged(false)} title={page.title} width={ENLARGED_WIDTH}>
        {enlarged ? (
          <UiPageFrame
            sessionId={sessionId}
            pageId={page.pageId}
            revision={page.revision}
            title={page.title}
            maxHeight={Math.round(window.innerHeight * 0.72)}
          />
        ) : null}
      </Modal>
    </Collapsible>
  )
}
