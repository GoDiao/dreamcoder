import { useState } from 'react'
import { BadgeCheck, Check, Globe, X } from 'lucide-react'
import { CardTitle } from '../shared/ui/card'
import { Button } from '../shared/ui/button'
import { useChatStore } from '../../stores/chatStore'
import { useTranslation } from '../../i18n'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { replyBrowserGrant, type BrowserGrantDecision } from '../../lib/shell'
import type { PendingBrowserGrant } from '../../types/chat'
import { AwaitingApprovalBadge } from './AwaitingApprovalBadge'

function BrowserGrantCard({ grant }: { grant: PendingBrowserGrant }) {
  const t = useTranslation()
  const [pending, setPending] = useState<BrowserGrantDecision | null>(null)
  const [failed, setFailed] = useState(false)

  const reply = async (decision: BrowserGrantDecision) => {
    setPending(decision)
    setFailed(false)
    try {
      await replyBrowserGrant({ requestId: grant.requestId, decision })
    } catch (error) {
      console.error('[browser] Failed to reply to a browser grant', error)
      setFailed(true)
      setPending(null)
    }
  }

  return (
    <div
      role="group"
      aria-label={t('browserGrant.title')}
      className="mb-4 flex flex-col overflow-hidden rounded-xl border border-warning bg-popover text-sm text-card-foreground"
    >
      <div className="flex items-center gap-3 bg-muted px-4 py-3">
        <Globe className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <CardTitle>{t('browserGrant.title')}</CardTitle>
          <AwaitingApprovalBadge />
        </div>
      </div>

      <div className="border-t border-border px-4 py-3">
        <div
          data-testid="browser-grant-origin"
          className="break-all rounded-md bg-muted px-3 py-2 font-mono text-sm font-semibold text-foreground"
        >
          {grant.origin}
        </div>
        <p className="mt-2 break-words text-xs text-muted-foreground">{grant.action}</p>
        {grant.allowOnce ? null : (
          <p className="mt-2 text-xs text-subtle-foreground">{t('browserGrant.bypassNote')}</p>
        )}
        {grant.allowSession ? null : (
          <p className="mt-2 text-xs text-subtle-foreground">{t('browserGrant.onceOnlyNote')}</p>
        )}
        {failed ? (
          <p role="alert" className="mt-2 text-xs text-destructive">{t('browserGrant.replyFailed')}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        {grant.allowOnce ? (
          <Button size="sm" disabled={pending !== null} loading={pending === 'once'} onClick={() => reply('once')}>
            <Check data-icon="inline-start" aria-hidden="true" />
            {t('browserGrant.allowOnce')}
          </Button>
        ) : null}
        {grant.allowSession ? (
          <Button
            variant={grant.allowOnce ? 'ghost' : 'default'}
            size="sm"
            disabled={pending !== null}
            loading={pending === 'session'}
            onClick={() => reply('session')}
          >
            <BadgeCheck data-icon="inline-start" aria-hidden="true" />
            {t(grant.allowOnce ? 'browserGrant.trustSession' : 'browserGrant.trustSessionBypass')}
          </Button>
        ) : null}
        <div className="flex-1" />
        <Button
          variant="destructive"
          size="sm"
          disabled={pending !== null}
          loading={pending === 'deny'}
          onClick={() => reply('deny')}
        >
          <X data-icon="inline-start" aria-hidden="true" />
          {t('permission.deny')}
        </Button>
      </div>
    </div>
  )
}

export function BrowserGrantRequests({ sessionId }: { sessionId: string | null | undefined }) {
  const grants = useChatStore((state) => (sessionId ? state.sessions[sessionId]?.mirror?.pendingBrowserGrants : undefined))
  if (!grants?.length || !isDesktopRuntime()) return null
  return (
    <>
      {grants.map((grant) => (
        <BrowserGrantCard key={grant.requestId} grant={grant} />
      ))}
    </>
  )
}
