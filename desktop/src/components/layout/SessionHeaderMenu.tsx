import { useEffect, useRef, useState } from 'react'
import { Download, Ellipsis, ListChecks, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { Button } from '../shared/Button'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Modal } from '../shared/Modal'
import { ExportSessionDialog } from './ExportSessionDialog'

type SessionHeaderMenuProps = {
  sessionId: string
  title: string
}

/** The "⋯" menu in the session header: rename, export, bulk manage, delete. */
export function SessionHeaderMenu({ sessionId, title }: SessionHeaderMenuProps) {
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [exporting, setExporting] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const submitRename = async () => {
    const next = renameValue.trim()
    if (!next) return
    await useSessionStore.getState().renameSession(sessionId, next)
    setRenaming(false)
  }

  const confirmDelete = async () => {
    await useSessionStore.getState().deleteSession(sessionId)
    useChatStore.getState().disconnectSession(sessionId)
    useTabStore.getState().closeTab(sessionId)
    setConfirmingDelete(false)
  }

  const itemClass =
    'flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]'

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('session.header.actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('session.header.actions')}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-[29px] w-[29px] items-center justify-center rounded-[7px] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
          open
            ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <Ellipsis size={17} strokeWidth={1.9} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="motion-menu absolute right-0 top-[calc(100%+4px)] z-40 w-44 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]"
          data-state="open"
        >
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} text-[var(--color-text-primary)]`}
            onClick={() => {
              setOpen(false)
              setRenameValue(title)
              setRenaming(true)
            }}
          >
            <Pencil size={15} aria-hidden="true" />
            {t('common.rename')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} text-[var(--color-text-primary)]`}
            onClick={() => {
              setOpen(false)
              setExporting(true)
            }}
          >
            <Download size={15} aria-hidden="true" />
            {t('exportSession.menuItem')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} text-[var(--color-text-primary)]`}
            onClick={() => {
              setOpen(false)
              useUIStore.getState().setSidebarOpen(true)
              useSessionStore.getState().enterBatchMode()
            }}
          >
            <ListChecks size={15} aria-hidden="true" />
            {t('sidebar.batchManage')}
          </button>
          <div className="my-1 h-px bg-[var(--color-border-separator)]" role="separator" />
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} text-[var(--color-error)]`}
            onClick={() => {
              setOpen(false)
              setConfirmingDelete(true)
            }}
          >
            <Trash2 size={15} aria-hidden="true" />
            {t('common.delete')}
          </button>
        </div>
      )}

      <ExportSessionDialog sessionId={sessionId} open={exporting} onClose={() => setExporting(false)} />

      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title={t('common.rename')}
        width={420}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="xs" onClick={() => setRenaming(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="xs" disabled={!renameValue.trim()} onClick={() => void submitRename()}>
              {t('common.save')}
            </Button>
          </div>
        )}
      >
        <input
          autoFocus
          aria-label={t('common.rename')}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submitRename()
          }}
          className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
        />
      </Modal>

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        body={t('sidebar.confirmDelete')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
      />
    </div>
  )
}
