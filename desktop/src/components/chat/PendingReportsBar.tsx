import { Inbox } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { relativeTimeLabel } from '../../lib/relativeTime'
import { useChatStore } from '../../stores/chatStore'
import { SessionLink } from './SessionLink'
import type { SessionState } from '../../types/chat'
import { TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '../shared/ui/trace'
import { ChatTraceBar } from './ChatTraceBar'

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
    <ChatTraceBar>
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
    </ChatTraceBar>
  )
}
