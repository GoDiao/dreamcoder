import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useChatStore, useSessionField } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation, type TranslationKey } from '../../i18n'
import { ElapsedTime } from './ElapsedTime'

function translateServerVerb(
  t: (key: TranslationKey) => string,
  verb: string,
): string {
  const key = `serverVerb.${verb}` as TranslationKey
  const translated = t(key)
  return translated === key ? verb : translated
}

function formatRetrySeconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000))
}

function formatErrorType(errorType: string | undefined): string | null {
  if (!errorType) return null
  return errorType
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function StreamingIndicator() {
  const t = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  const activeTabId = useTabStore((s) => s.activeTabId)
  const chatState = useSessionField(activeTabId, 'chatState') ?? 'idle'
  const statusVerb = useSessionField(activeTabId, 'statusVerb') ?? ''
  const apiRetry = useSessionField(activeTabId, 'apiRetry') ?? null
  const turnStartedAt = useChatStore((s) => {
    const turn = activeTabId ? s.sessions[activeTabId]?.mirror?.turn : undefined
    return turn && turn.phase !== 'idle' ? turn.startedAt : undefined
  })
  const outputTokens = useChatStore((s) => activeTabId ? s.sessions[activeTabId]?.tokenUsage?.output_tokens ?? 0 : 0)

  useEffect(() => {
    if (!apiRetry) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [apiRetry?.receivedAt, apiRetry?.retryDelayMs])

  if (apiRetry) {
    const remainingMs = Math.max(0, apiRetry.retryDelayMs - (now - apiRetry.receivedAt))
    const statusText = apiRetry.errorStatus !== null
      ? t('chat.retry.httpStatus', { status: apiRetry.errorStatus })
      : formatErrorType(apiRetry.errorType) ?? t('chat.retry.networkError')
    const detailText = apiRetry.errorMessage?.trim()

    return (
      <div
        data-testid="api-retry-indicator"
        role="status"
        aria-live="polite"
        className="mb-2 flex w-full max-w-[min(720px,100%)] flex-wrap items-center gap-2 rounded-md border border-warning/35 bg-warning-surface px-3 py-2 text-xs text-foreground"
      >
        <RefreshCw size={14} strokeWidth={2.2} className="shrink-0 animate-spin text-warning" aria-hidden="true" />
        <span className="font-medium">{t('chat.retry.title')}</span>
        <span className="rounded-sm border border-warning/20 bg-background/70 px-1.5 py-0.5 font-mono text-2xs leading-none text-foreground">
          {t('chat.retry.attempt', { attempt: apiRetry.attempt, max: apiRetry.maxRetries })}
        </span>
        <span className="rounded-sm border border-warning/20 bg-background/70 px-1.5 py-0.5 font-mono text-2xs leading-none text-foreground">
          {statusText}
        </span>
        <span className="text-muted-foreground">
          {t('chat.retry.waiting', { seconds: formatRetrySeconds(remainingMs) })}
        </span>
        {detailText && (
          <HintTooltip content={detailText}><span className="min-w-0 max-w-full truncate text-muted-foreground">
            {detailText}
          </span></HintTooltip>
        )}
      </div>
    )
  }

  let verb: string
  if (statusVerb) {
    verb = translateServerVerb(t, statusVerb)
  } else {
    verb = chatState === 'thinking'
      ? t('serverVerb.Thinking')
      : chatState === 'compacting'
        ? t('serverVerb.Compacting conversation')
      : chatState === 'tool_executing'
        ? t('serverVerb.Running')
        : t('serverVerb.Working')
  }

  return (
    <div className="mb-2 flex w-fit items-center gap-2 rounded-full border border-border/40 bg-card px-3 py-1">
      <span className="text-primary animate-shimmer text-xs">✦</span>
      <span className="text-xs font-medium text-muted-foreground">{verb}...</span>
      {turnStartedAt !== undefined && <ElapsedTime startedAt={turnStartedAt} />}
      {outputTokens > 0 && (
        <span className="text-3xs text-subtle-foreground">
          · ↓ {outputTokens}
        </span>
      )}
    </div>
  )
}
