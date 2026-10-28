import { useMemo } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'
import { Button } from './ui/button'

export type SelectionPopoverQuote = {
  selection: { x: number; y: number; width?: number; height?: number } | null
  contains: (target: EventTarget | null) => boolean
  clear: () => void
}

export function SelectionPopover({ quote, label, onAdd }: {
  quote: SelectionPopoverQuote
  label: string
  onAdd: () => void
}) {
  const { selection } = quote
  const x = selection?.x ?? 0
  const y = selection?.y ?? 0
  const width = selection?.width ?? 0
  const height = selection?.height ?? 0
  const anchor = useMemo(() => ({ current: { getBoundingClientRect: () => new DOMRect(x, y, width, height) } }), [x, y, width, height])
  return (
    <Popover open={selection !== null} onOpenChange={(open) => { if (!open) quote.clear() }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent side="top" align="start" sideOffset={6} collisionPadding={12} className="w-auto p-1" aria-label={label}
        onMouseUp={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
        onInteractOutside={(event) => { if (quote.contains(event.target)) event.preventDefault() }}
        onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
        <Button variant="ghost" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={onAdd}>
          {label}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
