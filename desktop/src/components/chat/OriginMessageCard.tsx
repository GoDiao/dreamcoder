import { memo, useState, type ReactNode } from 'react'
import { MessageSquareShare, SquareKanban } from 'lucide-react'
import { useTranslation, type TranslationKey } from '../../i18n'
import type { KanbanOrigin, SessionOrigin, UserMessageOrigin } from '../../types/chat'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from '../shared/ui/trace'
import { MessageActionBar } from './MessageActionBar'
import { SessionLink } from './SessionLink'
import { toast } from 'sonner'
import { Button } from '../shared/ui/button'
import { boardForProject, useKanbanStore } from '../../stores/kanbanStore'
import { openBoardTab, useTabStore } from '../../stores/tabStore'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { kanbanErrorMessage, type Translate } from '../kanban/board'

const SESSION_PURPOSE_LABEL_KEYS: Record<SessionOrigin['purpose'], TranslationKey> = {
  message: 'chat.sessionMessage.purpose.message',
  brief: 'chat.sessionMessage.purpose.brief',
  report: 'chat.sessionMessage.purpose.report',
}

const KANBAN_PURPOSE_LABEL_KEYS: Record<KanbanOrigin['purpose'], TranslationKey> = {
  assignment: 'chat.kanbanMessage.purpose.assignment',
  revocation: 'chat.kanbanMessage.purpose.revocation',
  comment: 'chat.kanbanMessage.purpose.comment',
  review: 'chat.kanbanMessage.purpose.review',
  blocked: 'chat.kanbanMessage.purpose.blocked',
  changes_requested: 'chat.kanbanMessage.purpose.changes_requested',
  accepted: 'chat.kanbanMessage.purpose.accepted',
  unblocked: 'chat.kanbanMessage.purpose.unblocked',
  reset: 'chat.kanbanMessage.purpose.reset',
  cancelled: 'chat.kanbanMessage.purpose.cancelled',
  reopened: 'chat.kanbanMessage.purpose.reopened',
}

type Header = {
  icon: ReactNode
  from: TranslationKey
  source: ReactNode
  purpose: TranslationKey
  preview?: string
}

async function openKanbanCard(t: Translate, origin: KanbanOrigin, card: number, inPanel: boolean) {
  try {
    const store = useKanbanStore.getState()
    const board = boardForProject(store.boards ?? await store.loadBoards(), origin.project)
    if (!board) {
      toast.error(t('kanban.error.NOT_FOUND'))
      return
    }
    const sessionId = useTabStore.getState().activeTabId
    if (inPanel && sessionId) {
      useWorkspacePanelStore.getState().openTab(sessionId, { kind: 'task', board: board.key, card })
      return
    }
    const tabId = openBoardTab(origin.project, t('kanban.title'))
    useWorkspacePanelStore.getState().openTab(tabId, { kind: 'task', board: board.key, card })
  } catch (error) {
    toast.error(kanbanErrorMessage(t, error))
  }
}

function KanbanCardLink({ origin }: { origin: KanbanOrigin }) {
  const t = useTranslation()
  const { card } = origin
  const inPanel = !(useMobileViewport() && !isDesktopRuntime())
  return (
    <Button
      type="button"
      variant="link"
      onClick={() => void openKanbanCard(t, origin, card.id, inPanel)}
      aria-label={t('chat.kanbanMessage.open', { card: `#${card.id}` })}
      className="h-auto min-w-0 max-w-[40%] justify-start px-0 text-[length:inherit]"
    >
      <span className="truncate">#{card.id} {card.title}</span>
    </Button>
  )
}

function headerFor(origin: UserMessageOrigin): Header {
  if (origin.kind === 'kanban') {
    return {
      icon: <SquareKanban />,
      from: 'chat.kanbanMessage.from',
      source: <KanbanCardLink origin={origin} />,
      purpose: KANBAN_PURPOSE_LABEL_KEYS[origin.purpose],
    }
  }
  return {
    icon: <MessageSquareShare />,
    from: 'chat.sessionMessage.from',
    source: <SessionLink sessionId={origin.sessionId} sentTitle={origin.name} className="min-w-0 max-w-[40%]" />,
    purpose: SESSION_PURPOSE_LABEL_KEYS[origin.purpose],
    preview: origin.summary,
  }
}

type Props = {
  content: string
  origin: UserMessageOrigin
  timestamp?: number
}

export const OriginMessageCard = memo(function OriginMessageCard({ content, origin, timestamp }: Props) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const header = headerFor(origin)

  return (
    <div data-message-shell={origin.kind} className="group mb-1 flex w-full min-w-0 flex-col">
      <Trace>
        <TraceCollapsible open={expanded} onOpenChange={setExpanded}>
          <div className="flex min-h-7 min-w-0 items-center gap-2">
            <TraceLine className="flex-shrink-0">
              <TraceIcon>{header.icon}</TraceIcon>
              <TraceTitle className="flex-shrink-0">{t(header.from)}</TraceTitle>
            </TraceLine>
            {header.source}
            <TraceCollapsibleTrigger className="min-w-0 flex-1 select-none">
              <TraceLine>
                <span className="flex-shrink-0 text-ui-muted-foreground/70">{t(header.purpose)}</span>
                {!expanded && header.preview && <span className="min-w-0 flex-1 truncate text-ui-muted-foreground">{header.preview}</span>}
              </TraceLine>
            </TraceCollapsibleTrigger>
          </div>
          <TraceCollapsibleContent>
            <div className="text-ui-message leading-[1.7] text-[var(--color-text-primary)]">
              <MarkdownRenderer content={content} />
            </div>
            <MessageActionBar
              copyText={content}
              copyLabel={t('chat.copyPrompt')}
              align="start"
              timestamp={timestamp}
            />
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    </div>
  )
})
