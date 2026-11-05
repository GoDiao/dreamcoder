import { Inbox } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { relativeTimeLabel } from '../../lib/relativeTime'
import { useChatStore } from '../../stores/chatStore'
import { SessionLink } from './SessionLink'
import type { SessionState } from '../../types/chat'
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '../shared/ui/trace'

function PendingReportRow({ report }: { report: SessionState['pendingReports'][number] }) {
  const t = useTranslation()
  return (
    <li className="flex min-w-0 items-center gap-2 text-ui-aux">
      <SessionLink sessionId={report.from.sessionId} sentTitle={report.from.name} className="max-w-[30%] flex-shrink-0" />
      <span className="min-w-0 flex-1 truncate">{report.summary}</span>
      <TraceDescription>{relativeTimeLabel(t, Date.now() - report.createdAt)}</TraceDescription>
    </li>
  )
}

export function PendingReportsBar({ sessionId }: { sessionId: string | null | undefined }) {
  const t = useTranslation()
  const reports = useChatStore((state) => (sessionId ? state.sessions[sessionId]?.mirror?.pendingReports : undefined))
  if (!reports?.length) return null

  const title = reports.length === 1
    ? t('chat.pendingReports.one')
    : t('chat.pendingReports.other', { count: reports.length })

  return (
    <div className="shrink-0 px-8">
      <Trace className="mx-auto mb-2 max-w-[860px] rounded-lg border border-ui-border p-3">
        <TraceCollapsible>
          <TraceCollapsibleTrigger aria-label={title}>
            <TraceLine>
              <TraceIcon><Inbox /></TraceIcon>
              <TraceTitle>{title}</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="max-h-[240px] overflow-y-auto">
            <p className="mb-2 text-ui-aux">{t('chat.pendingReports.hint')}</p>
            <ul className="flex flex-col gap-1.5">
              {reports.map((report) => <PendingReportRow key={report.id} report={report} />)}
            </ul>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    </div>
  )
}
