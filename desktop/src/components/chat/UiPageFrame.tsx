import { useCallback, useEffect, useRef, useState } from 'react'
import { getBaseUrl } from '../../api/client'
import { useTranslation } from '../../i18n'
import {
  UI_PAGE_INITIAL_HEIGHT,
  UI_PAGE_READY_TIMEOUT_MS,
  buildHostContext,
  clampFrameHeight,
  hostContextChanged,
  initializeResponse,
  isFromFrame,
  parseUiPageMessage,
  uiPageUrl,
} from '../../lib/uiPageBridge'
import { useUIStore } from '../../stores/uiStore'
import { Skeleton } from '../shared/ui/skeleton'

type Status = 'loading' | 'ready' | 'failed'

type Props = {
  sessionId: string
  pageId: string
  revision: number
  title: string
  maxHeight?: number
}

export function UiPageFrame({ sessionId, pageId, revision, title, maxHeight }: Props) {
  const t = useTranslation()
  const theme = useUIStore((s) => s.theme)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const themeRef = useRef(theme)
  const sentThemeRef = useRef(theme)
  const [status, setStatus] = useState<Status>('loading')
  const [height, setHeight] = useState(UI_PAGE_INITIAL_HEIGHT)
  const [scriptError, setScriptError] = useState<string | null>(null)

  const post = useCallback((message: unknown) => {
    frameRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isFromFrame(event, frameRef.current?.contentWindow)) return
      const message = parseUiPageMessage(event.data)
      if (!message) return
      switch (message.kind) {
        case 'initialize':
          sentThemeRef.current = themeRef.current
          post(initializeResponse(message.id, buildHostContext(themeRef.current)))
          break
        case 'initialized':
          setStatus('ready')
          break
        case 'resize':
          setHeight(clampFrameHeight(message.height, maxHeight))
          break
        case 'error':
          setScriptError(message.message)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [maxHeight, post])

  useEffect(() => {
    themeRef.current = theme
    if (status !== 'ready' || sentThemeRef.current === theme) return
    sentThemeRef.current = theme
    post(hostContextChanged(buildHostContext(theme)))
  }, [post, status, theme])

  useEffect(() => {
    if (status !== 'loading') return
    const timer = window.setTimeout(() => setStatus('failed'), UI_PAGE_READY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  return (
    <div className="relative w-full">
      <iframe
        ref={frameRef}
        title={t('uiPage.frameTitle', { title })}
        src={uiPageUrl(getBaseUrl(), sessionId, pageId, revision)}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className={`block w-full border-0 bg-transparent ${status === 'ready' ? '' : 'opacity-0'}`}
        style={{ height }}
      />
      {status === 'loading' ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col gap-2 p-3" role="status" aria-label={t('uiPage.loading')}>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : null}
      {status === 'failed' ? (
        <div className="absolute inset-x-0 top-0 px-3 py-2 text-xs text-[var(--color-error)]" role="alert">
          {t('uiPage.loadFailed')}
        </div>
      ) : null}
      {scriptError ? (
        <div className="border-t border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-warning)]" role="status">
          {t('uiPage.scriptError', { message: scriptError })}
        </div>
      ) : null}
    </div>
  )
}
