import type { ReactNode } from 'react'
import { useTranslation } from '../../i18n'
import { useOverlayReturnFocus } from '../../hooks/useOverlayReturnFocus'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: number
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, width = 560, footer }: ModalProps) {
  const t = useTranslation()
  const focus = useOverlayReturnFocus()
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent {...focus} size="flush" aria-describedby={undefined} className="flex max-h-[85dvh] flex-col sm:max-w-none" style={{ width, maxWidth: 'calc(100vw - 32px)' }}>
        <div className={title ? 'shrink-0 px-6 pt-6 pr-12' : undefined}>
          <DialogHeader className={title ? undefined : 'sr-only'}>
            <DialogTitle>{title ?? t('common.dialog')}</DialogTitle>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 px-6 pb-6">{footer}</div>}
      </DialogContent>
    </Dialog>
  )
}
