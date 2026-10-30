import { ArrowLeft, ArrowRight, ExternalLink, Globe, MoreHorizontal, RotateCw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useTranslation, type TranslationKey } from '../../i18n'
import {
  browserGoBack,
  browserGoForward,
  browserReload,
  browserStop,
  hasBrowserGuest,
  openBrowserUrl,
  placeBrowserGuest,
  reloadAllBrowsers,
  submitBrowserInput,
} from '../../lib/browserGuests'
import { clearBrowserData, openBrowserUrlInSystem } from '../../lib/shell'
import type { BrowserRefusal } from '../../lib/shell/electronBridge'
import { useBrowserStore } from '../../stores/browserStore'
import type { WorkspaceTab } from '../../stores/workspacePanelStore'
import { ActionMenu } from '../shared/ActionMenu'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Tooltip } from '../shared/Tooltip'
import { Button } from '../shared/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '../shared/ui/empty'
import { Input } from '../shared/ui/input'

const REFUSAL_MESSAGES: Record<BrowserRefusal, TranslationKey> = {
  scheme: 'browser.refused.scheme',
  noProject: 'browser.refused.noProject',
  outsideProject: 'browser.refused.outsideProject',
  notFound: 'browser.refused.notFound',
  notHtml: 'browser.refused.notHtml',
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

type ToolbarButtonProps = {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}

function ToolbarButton({ label, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <Tooltip content={label}>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>
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
  const setNotice = useBrowserStore((state) => state.setNotice)
  const stageRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const { url } = tab

  useEffect(() => {
    setDraft(url)
  }, [url, tab.id])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    if (url && !hasBrowserGuest(tab.id)) openBrowserUrl(sessionId, tab.id, url)
    return placeBrowserGuest(tab.id, stage, true)
  }, [sessionId, tab.id, url])

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
          label={t('browser.openInSystem')}
          disabled={!url}
          onClick={() => {
            openBrowserUrlInSystem(url).catch((error: unknown) => toast.error(errorMessage(error)))
          }}
        >
          <ExternalLink aria-hidden="true" />
        </ToolbarButton>
        <ActionMenu
          label={t('browser.moreActions')}
          trigger={
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('browser.moreActions')}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          }
          actions={[{
            id: 'clear-data',
            label: t('browser.clearData'),
            icon: <Trash2 aria-hidden="true" />,
            danger: true,
            afterClose: true,
            onSelect: () => setConfirmClear(true),
          }]}
        />
      </form>

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
