import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useSessionStore } from '../../stores/sessionStore'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/ui/button'
import { Input } from '../shared/ui/input'

type RenameSessionDialogProps = {
  sessionId: string
  title: string
  open: boolean
  onClose: () => void
}

export function RenameSessionDialog({ sessionId, title, open, onClose }: RenameSessionDialogProps) {
  const t = useTranslation()
  const [value, setValue] = useState(title)

  useEffect(() => {
    if (open) setValue(title)
  }, [open, title])

  const submit = async () => {
    const next = value.trim()
    if (!next) return
    await useSessionStore.getState().renameSession(sessionId, next)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('common.rename')}
      width={420}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="xs" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="xs" disabled={!value.trim()} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </div>
      )}
    >
      <Input
        aria-label={t('common.rename')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submit()
        }}
      />
    </Modal>
  )
}
