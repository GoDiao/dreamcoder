import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, LayoutGrid, PencilLine, Presentation, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from '../../i18n'
import { presentDeck, runDeckCall, setDeckMessageHandler } from '../../lib/browserGuests'
import { DECK_NEXT_CALL, DECK_PREV_CALL, deckEditingCall, deckModeCall, type DeckEditMessage, type DeckState } from '../../lib/deckBridge'
import { stopArtifactHold, type ArtifactEditTarget } from '../../lib/artifactUserEdits'
import { applyDeckEdit, deleteDeckSlide, flushDeckEdits, isDeckConflict } from '../../lib/deckEdits'
import { errorMessage } from '../../lib/errorMessage'
import { useBrowserStore } from '../../stores/browserStore'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Tooltip } from '../shared/Tooltip'
import { Button } from '../shared/ui/button'

type DeckEditTarget = Omit<ArtifactEditTarget, 'tabId'>

function useDeckWriteBack(tabId: string, editTarget: DeckEditTarget | undefined, askToDelete: (asking: boolean) => void) {
  const t = useTranslation()
  const root = editTarget?.root
  const name = editTarget?.name
  const title = editTarget?.title
  const sessionId = editTarget?.sessionId
  useEffect(() => {
    if (root === undefined || name === undefined || title === undefined || sessionId === undefined) return
    const target: ArtifactEditTarget = { tabId, root, name, title, sessionId }
    const report = (type: DeckEditMessage['type']) => (error: unknown) => {
      if (!isDeckConflict(error)) toast.error(t('deck.saveFailed', { message: errorMessage(error) }))
      else toast.error(t(type === 'order' ? 'deck.orderConflict' : 'deck.editConflict'))
    }
    setDeckMessageHandler(tabId, (message) => {
      if (message.type === 'delete') askToDelete(true)
      else applyDeckEdit(target, message).catch(report(message.type))
    })
    flushDeckEdits(target).catch(report('edit'))
    return () => {
      setDeckMessageHandler(tabId, null)
      stopArtifactHold(tabId)
    }
  }, [tabId, root, name, title, sessionId, askToDelete, t])
}

function DeckEditControls({
  tabId,
  deck,
  editTarget,
  confirming,
  setConfirming,
}: {
  tabId: string
  deck: DeckState
  editTarget: DeckEditTarget
  confirming: boolean
  setConfirming: (confirming: boolean) => void
}) {
  const t = useTranslation()
  const [deleting, setDeleting] = useState(false)
  const unavailable = deck.count === 0 || deck.mode === 'present'
  const slide = deck.slide

  const remove = async () => {
    if (!slide) return
    setDeleting(true)
    try {
      await deleteDeckSlide({ tabId, ...editTarget }, slide)
      setConfirming(false)
    } catch (error) {
      toast.error(t('deck.deleteFailed', { message: errorMessage(error) }))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="ml-auto flex min-w-0 items-center gap-0.5">
      {deck.editing && (
        <span data-testid="deck-editing-hint" className="min-w-0 truncate px-1.5 text-xs text-muted-foreground">
          {t(deck.mode === 'overview' ? 'deck.editingHintOverview' : 'deck.editingHintBrowse')}
        </span>
      )}
      <Tooltip content={deck.editing ? undefined : t('deck.editTooltip')}>
        <Button type="button" variant="ghost-muted" size="xs" aria-pressed={deck.editing} disabled={unavailable} onClick={() => void runDeckCall(tabId, deckEditingCall(!deck.editing))}>
          <PencilLine aria-hidden="true" />
          {t('deck.edit')}
        </Button>
      </Tooltip>
      <Button type="button" variant="ghost-muted" size="xs" disabled={unavailable || !slide} onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden="true" />
        {t('deck.deleteSlide')}
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={remove}
        title={t('deck.deleteTitle')}
        body={t('deck.deleteBody', { title: deck.title ?? slide ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={deleting}
      />
    </div>
  )
}

export function DeckControls({ tabId, editTarget }: { tabId: string; editTarget?: DeckEditTarget }) {
  const t = useTranslation()
  const deck = useBrowserStore((state) => state.pageByTab[tabId]?.deck)
  const [confirming, setConfirming] = useState(false)
  useDeckWriteBack(tabId, editTarget, setConfirming)
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
      {editTarget && <DeckEditControls tabId={tabId} deck={deck} editTarget={editTarget} confirming={confirming} setConfirming={setConfirming} />}
    </div>
  )
}
