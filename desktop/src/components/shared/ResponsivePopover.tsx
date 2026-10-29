import type { ReactElement, ReactNode } from 'react'
import { Slot } from 'radix-ui'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { MobileBottomSheet } from './MobileBottomSheet'
import { Tooltip } from './Tooltip'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  trigger: ReactElement
  children: ReactNode
  triggerTooltip?: string
  contentClassName?: string
  testId?: string
}

export function ResponsivePopover({ open, onOpenChange, title, trigger, children, triggerTooltip, contentClassName, testId }: Props) {
  const mobile = useMobileViewport() && !isDesktopRuntime()
  if (mobile) return (
    <>
      <Slot.Root onClick={() => onOpenChange(!open)} aria-haspopup="dialog" aria-expanded={open}>{trigger}</Slot.Root>
      <MobileBottomSheet open={open} onClose={() => onOpenChange(false)} title={title} ariaLabel={title} testId={testId}>
        {children}
      </MobileBottomSheet>
    </>
  )
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip content={triggerTooltip}><PopoverTrigger asChild>{trigger}</PopoverTrigger></Tooltip>
      <PopoverContent aria-label={title} align="start" sideOffset={8} collisionPadding={12} className={contentClassName} data-testid={testId}>
        {children}
      </PopoverContent>
    </Popover>
  )
}
