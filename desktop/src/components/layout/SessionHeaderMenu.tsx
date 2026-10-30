import { useState } from 'react'
import { Download, Ellipsis, ListChecks, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { ActionMenu, type MenuAction } from '../shared/ActionMenu'
import { Button } from '../shared/ui/button'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Modal } from '../shared/Modal'
import { Input } from '../shared/ui/input'
import { ExportSessionDialog } from './ExportSessionDialog'

type SessionHeaderMenuProps = {
  sessionId: string
  title: string
}

export function SessionHeaderMenu({ sessionId, title }: SessionHeaderMenuProps) {
  const t = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [exporting, setExporting] = useState(false)

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

  const actions: MenuAction[] = [
    { id: 'rename', label: t('common.rename'), icon: <Pencil aria-hidden="true" />, afterClose: true, onSelect: () => { setRenameValue(title); setRenaming(true) } },
    { id: 'export', label: t('exportSession.menuItem'), icon: <Download aria-hidden="true" />, afterClose: true, onSelect: () => setExporting(true) },
    { id: 'batch', label: t('sidebar.batchManage'), icon: <ListChecks aria-hidden="true" />, onSelect: () => {
      useUIStore.getState().setSidebarOpen(true)
      useSessionStore.getState().enterBatchMode()
    } },
    { id: 'delete', label: t('common.delete'), icon: <Trash2 aria-hidden="true" />, danger: true, separatorBefore: true, afterClose: true, onSelect: () => setConfirmingDelete(true) },
  ]

  return (
    <>
      <ActionMenu
        label={t('session.header.actions')}
        trigger={(
          <Button variant="ghost" size="icon" aria-label={t('session.header.actions')}>
            <Ellipsis size={17} aria-hidden="true" />
          </Button>
        )}
        actions={actions}
      />

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
        <Input
          aria-label={t('common.rename')}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submitRename()
          }}
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
        confirmVariant="destructive"
      />
    </>
  )
}
