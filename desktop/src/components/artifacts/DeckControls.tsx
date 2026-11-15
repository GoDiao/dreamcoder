import { ChevronLeft, ChevronRight, LayoutGrid, Presentation } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from '../../i18n'
import { presentDeck, runDeckCall } from '../../lib/browserGuests'
import { DECK_NEXT_CALL, DECK_PREV_CALL, deckModeCall } from '../../lib/deckBridge'
import { errorMessage } from '../../lib/errorMessage'
import { useBrowserStore } from '../../stores/browserStore'
import { Tooltip } from '../shared/Tooltip'
import { Button } from '../shared/ui/button'

export function DeckControls({ tabId }: { tabId: string }) {
  const t = useTranslation()
  const deck = useBrowserStore((state) => state.pageByTab[tabId]?.deck)
  if (!deck) return null

  const overview = deck.mode === 'overview'
  const empty = deck.count === 0

  return (
    <div data-testid="deck-controls" className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border px-2">
      <Tooltip content={t('deck.previous')}>
        <Button type="button" variant="ghost-muted" size="icon-xs" aria-label={t('deck.previous')} disabled={deck.index <= 0} onClick={() => void runDeckCall(tabId, DECK_PREV_CALL)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content={t('deck.next')}>
        <Button type="button" variant="ghost-muted" size="icon-xs" aria-label={t('deck.next')} disabled={deck.index >= deck.count - 1} onClick={() => void runDeckCall(tabId, DECK_NEXT_CALL)}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </Tooltip>
      <span data-testid="deck-position" className="mx-1.5 text-xs text-muted-foreground tabular-nums">
        {t('deck.position', { current: deck.index + 1, total: deck.count })}
      </span>
      <Button type="button" variant="ghost-muted" size="xs" aria-pressed={overview} disabled={empty} onClick={() => void runDeckCall(tabId, deckModeCall(overview ? 'browse' : 'overview'))}>
        <LayoutGrid aria-hidden="true" />
        {t('deck.overview')}
      </Button>
      <Button
        type="button"
        variant="ghost-muted"
        size="xs"
        disabled={empty}
        onClick={() => {
          presentDeck(tabId).catch((error: unknown) => toast.error(t('deck.presentFailed', { message: errorMessage(error) })))
        }}
      >
        <Presentation aria-hidden="true" />
        {t('deck.present')}
      </Button>
    </div>
  )
}
