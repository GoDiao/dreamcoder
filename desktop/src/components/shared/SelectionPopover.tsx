import { Fragment, useMemo } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'
import { Button } from './ui/button'

export type SelectionPopoverQuote = {
  selection: { x: number; y: number; width?: number; height?: number } | null
  contains: (target: EventTarget | null) => boolean
  clear: () => void
}

export type SelectionPopoverAction = {
  label: string
  onSelect: () => void
  loading?: boolean
}

export function SelectionPopover({ quote, label, actions }: {
  quote: SelectionPopoverQuote
  label: string
  actions: SelectionPopoverAction[]
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
      <PopoverContent side="top" align="start" sideOffset={6} collisionPadding={12} size="flush" className="w-auto" aria-label={label}
        onMouseUp={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
        onInteractOutside={(event) => { if (quote.contains(event.target)) event.preventDefault() }}
        onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
        <div className="flex items-center">
          {actions.map((action, index) => (
            <Fragment key={action.label}>
              {index > 0 && <span aria-hidden="true" className="h-4 w-px bg-border" />}
              <Button variant="ghost" size="xs" loading={action.loading} onMouseDown={(event) => event.preventDefault()} onClick={action.onSelect}>
                {action.label}
              </Button>
            </Fragment>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
