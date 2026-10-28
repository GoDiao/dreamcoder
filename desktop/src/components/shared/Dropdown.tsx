import type { ReactElement } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './ui/dropdown-menu'

type DropdownItem<T extends string> = {
  value: T
  label: string
  description?: string
}

type DropdownProps<T extends string> = {
  items: DropdownItem<T>[]
  value: T
  onChange: (value: T) => void
  trigger: ReactElement
  width?: number
  maxHeight?: number
  align?: 'left' | 'right'
  className?: string
}

export function Dropdown<T extends string>({ items, value, onChange, trigger, width = 320, maxHeight, align = 'left', className }: DropdownProps<T>) {
  return (
    <DropdownMenu>
      <div className={className}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align={align === 'left' ? 'start' : 'end'} collisionPadding={8} style={{ width, maxHeight }}>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => {
          const item = items.find((candidate) => candidate.value === next)
          if (item) onChange(item.value)
        }}>
          {items.map((item) => (
            <DropdownMenuRadioItem key={item.value} value={item.value}>
              <div className="min-w-0 flex-1">
                <div>{item.label}</div>
                {item.description && <div className="text-xs text-ui-muted-foreground">{item.description}</div>}
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
