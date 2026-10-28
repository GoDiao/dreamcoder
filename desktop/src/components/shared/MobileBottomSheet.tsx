import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useOverlayReturnFocus } from '../../hooks/useOverlayReturnFocus'
import { cn } from '../../lib/utils'
import { Button } from './ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from './ui/drawer'

type Props = {
  open: boolean
  onClose: () => void
  onExited?: () => void
  title: ReactNode
  children: ReactNode
  closeLabel?: string
  ariaLabel?: string
  contentClassName?: string
  testId?: string
}

export function MobileBottomSheet({ open, onClose, onExited, title, children, closeLabel, ariaLabel, contentClassName, testId }: Props) {
  const t = useTranslation()
  const focus = useOverlayReturnFocus(onExited)
  return (
    <Drawer open={open} onOpenChange={(next) => { if (!next) onClose() }} shouldScaleBackground={false}>
      <DrawerContent {...focus} aria-label={ariaLabel} aria-describedby={undefined} data-testid={testId} className="max-h-[78dvh] min-h-0">
        <div className="shrink-0 border-b border-ui-border px-4 py-3">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerClose asChild><Button variant="ghost" size="icon-lg" aria-label={closeLabel ?? t('common.close')}><X /></Button></DrawerClose>
          </div>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto', contentClassName)}>{children}</div>
      </DrawerContent>
    </Drawer>
  )
}
