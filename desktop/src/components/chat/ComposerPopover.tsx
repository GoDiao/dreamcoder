import type { ReactNode, RefObject } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '../shared/ui/popover'

type Props = {
  anchorRef: RefObject<HTMLElement | null>
  inputRef: RefObject<HTMLTextAreaElement | null>
  label: string
  onClose: () => void
  preserveInputFocus?: boolean
  children: ReactNode
}

export function ComposerPopover({ anchorRef, inputRef, label, onClose, preserveInputFocus, children }: Props) {
  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        aria-label={label}
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)] gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => { if (preserveInputFocus) event.preventDefault() }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (document.activeElement === document.body) inputRef.current?.focus()
        }}
        onInteractOutside={(event) => { if (inputRef.current?.contains(event.target as Node)) event.preventDefault() }}
        onEscapeKeyDown={(event) => { if (event.isComposing || event.keyCode === 229) event.preventDefault() }}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
