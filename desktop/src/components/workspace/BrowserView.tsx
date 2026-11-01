import { ArrowLeft, ArrowRight, ExternalLink, Globe, MoreHorizontal, MousePointerClick, RotateCw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useArtifactExportActions } from '../../hooks/useArtifactExportActions'
import { useArtifactThumbnail } from '../../hooks/useArtifactThumbnail'
import { useCanvasTab } from '../../hooks/useCanvasTab'
import { useTranslation, type TranslationKey } from '../../i18n'
import {
  browserGoBack,
  browserGoForward,
  browserReload,
  browserStop,
  hasBrowserGuest,
  isProjectPageUrl,
  openBrowserUrl,
  placeBrowserGuest,
  reloadAllBrowsers,
  resolveStoredBrowserUrl,
  submitBrowserInput,
} from '../../lib/browserGuests'
import { errorMessage } from '../../lib/errorMessage'
import { stopBrowserPick, toggleBrowserPick } from '../../lib/browserPicks'
import { clearBrowserData, openBrowserUrlInSystem } from '../../lib/shell'
import type { BrowserRefusal } from '../../lib/shell/electronBridge'
import { parseDesignCandidates, respondWithDesignChoice, useDesignChoiceRequest } from '../../lib/designChoice'
import { useBrowserStore } from '../../stores/browserStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { BROWSER_SEARCH_ENGINE_IDS, isBrowserSearchEngineId, type BrowserSearchEngineId } from '../../types/settings'
import type { WorkspaceTab } from '../../stores/workspacePanelStore'
import { ActionMenu } from '../shared/ActionMenu'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Tooltip } from '../shared/Tooltip'
import { Button } from '../shared/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '../shared/ui/empty'
import { Input } from '../shared/ui/input'
import { BrowserActivityBar } from './BrowserActivityBar'

const REFUSAL_MESSAGES: Record<BrowserRefusal, TranslationKey> = {
  scheme: 'browser.refused.scheme',
  noProject: 'browser.refused.noProject',
  outsideProject: 'browser.refused.outsideProject',
  notFound: 'browser.refused.notFound',
  notHtml: 'browser.refused.notHtml',
}

const SEARCH_ENGINE_LABELS: Record<BrowserSearchEngineId, TranslationKey> = {
  bing: 'browser.search.bing',
  google: 'browser.search.google',
  duckduckgo: 'browser.search.duckduckgo',
  baidu: 'browser.search.baidu',
}

type ToolbarButtonProps = {
  label: string
  disabled?: boolean
  pressed?: boolean
  onClick: () => void
  children: React.ReactNode
}

function ToolbarButton({ label, disabled, pressed, onClick, children }: ToolbarButtonProps) {
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant={pressed ? 'secondary' : 'ghost'}
        size="icon-sm"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  )
}

type BrowserTab = Extract<WorkspaceTab, { kind: 'browser' }>

export function BrowserView({ sessionId, tab, projectRoot }: { sessionId: string; tab: BrowserTab; projectRoot: string | null }) {
  const t = useTranslation()
  const page = useBrowserStore((state) => state.pageByTab[tab.id])
  const notice = useBrowserStore((state) => state.noticeByTab[tab.id])
  const picking = useBrowserStore((state) => state.pickActiveByTab[tab.id] === true)
  const setNotice = useBrowserStore((state) => state.setNotice)
  const searchEngine = useSettingsStore((state) => state.browserSearchEngine)
  const setSearchEngine = useSettingsStore((state) => state.setBrowserSearchEngine)
  const stageRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const { url } = tab
  useArtifactThumbnail(tab.id, tab.artifact?.board === undefined ? tab.artifact : undefined)
  useCanvasTab(tab.root !== undefined && tab.artifact?.canvas ? { tabId: tab.id, sessionId, root: tab.root, name: tab.artifact.name, artifact: tab.artifact } : null)
  const designRequest = useDesignChoiceRequest(sessionId)
  const templateId = tab.template?.id
  const offeredTemplate = templateId !== undefined && designRequest !== null && parseDesignCandidates(designRequest.input).some((candidate) => candidate.id === templateId)
  const exportActions = useArtifactExportActions({ tabId: tab.id, sessionId, title: tab.title || tab.artifact?.name || '' })
  const exportable = tab.artifact !== undefined && !tab.artifact.canvas

  useEffect(() => {
    setDraft(url)
  }, [url, tab.id])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    if (url && !hasBrowserGuest(tab.id)) {
      if (isProjectPageUrl(url)) {
        resolveStoredBrowserUrl(tab, projectRoot)
          .then((resolved) => {
            if (!hasBrowserGuest(tab.id)) openBrowserUrl(sessionId, tab.id, resolved)
          })
          .catch((error: unknown) => {
            console.warn('[browser] could not reopen the stored project page', url, error)
            setNotice(tab.id, { kind: 'refused', reason: 'notFound', url })
          })
      } else {
        openBrowserUrl(sessionId, tab.id, url)
      }
    }
    return placeBrowserGuest(tab.id, stage, true)
  }, [sessionId, tab.id, url])

  useEffect(() => {
    if (!picking) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void stopBrowserPick(tab.id)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [picking, tab.id])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim()) return
    submitBrowserInput(sessionId, tab.id, draft, projectRoot).catch((error: unknown) => toast.error(errorMessage(error)))
  }

  const clearData = async () => {
    try {
      await clearBrowserData()
      reloadAllBrowsers()
      toast.success(t('browser.dataCleared'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
    setConfirmClear(false)
  }

  const noticeText = notice?.kind === 'refused'
    ? t(REFUSAL_MESSAGES[notice.reason])
    : notice
      ? t('browser.loadFailed', { url: notice.url })
      : null
  const noticeDetail = notice?.kind === 'refused' ? notice.url : notice?.description

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="browser-view">
      <form onSubmit={submit} className="flex shrink-0 items-center gap-0.5 border-b border-[var(--color-border)] px-2 py-1.5">
        <ToolbarButton label={t('browser.back')} disabled={!page?.canGoBack} onClick={() => browserGoBack(tab.id)}>
          <ArrowLeft aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton label={t('browser.forward')} disabled={!page?.canGoForward} onClick={() => browserGoForward(tab.id)}>
          <ArrowRight aria-hidden="true" />
        </ToolbarButton>
        {page?.loading ? (
          <ToolbarButton label={t('browser.stop')} onClick={() => browserStop(tab.id)}>
            <X aria-hidden="true" />
          </ToolbarButton>
        ) : (
          <ToolbarButton label={t('browser.reload')} disabled={!url} onClick={() => browserReload(tab.id)}>
            <RotateCw aria-hidden="true" />
          </ToolbarButton>
        )}
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t('browser.address')}
          placeholder={t('browser.addressPlaceholder')}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="mx-1 h-7 flex-1"
        />
        <ToolbarButton
          label={picking ? t('browser.pickStop') : t('browser.pick')}
          pressed={picking}
          disabled={!picking && (!page?.ready || !url)}
          onClick={() => void toggleBrowserPick(tab.id)}
        >
          <MousePointerClick aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label={t('browser.openInSystem')}
          disabled={!url}
          onClick={() => {
            openBrowserUrlInSystem(url).catch((error: unknown) => toast.error(errorMessage(error)))
          }}
        >
          <ExternalLink aria-hidden="true" />
        </ToolbarButton>
        {offeredTemplate && designRequest && templateId && (
          <Button type="button" size="xs" className="ml-1" onClick={() => respondWithDesignChoice(sessionId, designRequest, templateId)}>
            {t('design.useTemplate')}
          </Button>
        )}
        <ActionMenu
          label={t('browser.moreActions')}
          trigger={
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('browser.moreActions')}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          }
          actions={[
            ...(exportable ? exportActions.map((action) => ({ ...action, disabled: !page?.ready })) : []),
            {
              id: 'search-engine',
              separatorBefore: exportable,
              label: t('browser.search.engine'),
              icon: <Search aria-hidden="true" />,
              value: searchEngine,
              options: BROWSER_SEARCH_ENGINE_IDS.map((id) => ({ value: id, label: t(SEARCH_ENGINE_LABELS[id]) })),
              onChange: (value) => {
                if (!isBrowserSearchEngineId(value)) return
                setSearchEngine(value).catch((error: unknown) => toast.error(errorMessage(error)))
              },
            },
            {
              id: 'clear-data',
              label: t('browser.clearData'),
              icon: <Trash2 aria-hidden="true" />,
              danger: true,
              afterClose: true,
              separatorBefore: true,
              onSelect: () => setConfirmClear(true),
            },
          ]}
        />
      </form>

      <BrowserActivityBar sessionId={sessionId} tabId={tab.id} />

      {noticeText && (
        <div
          role="status"
          data-testid="browser-notice"
          className="flex shrink-0 items-start gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-container)] px-3 py-2 text-ui-aux text-[var(--color-text-secondary)]"
        >
          <div className="min-w-0 flex-1">
            <div>{noticeText}</div>
            {noticeDetail && <div className="truncate text-[var(--color-text-tertiary)]">{noticeDetail}</div>}
          </div>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('browser.dismissNotice')} onClick={() => setNotice(tab.id, null)}>
            <X aria-hidden="true" />
          </Button>
        </div>
      )}

      <div ref={stageRef} data-testid="browser-stage" className="relative flex min-h-0 flex-1">
        {!url && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Globe aria-hidden="true" /></EmptyMedia>
              <EmptyDescription>{t('browser.empty')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearData}
        title={t('browser.clearDataTitle')}
        body={t('browser.clearDataBody')}
        confirmLabel={t('browser.clearDataConfirm')}
        cancelLabel={t('common.cancel')}
      />
    </div>
  )
}
