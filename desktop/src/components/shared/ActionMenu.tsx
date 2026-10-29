import { Fragment, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { useMenuAction } from '../../hooks/useMenuAction'
import { Tooltip } from './Tooltip'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu'

export type MenuAction = {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  afterClose?: boolean
}

function ActionItems({ actions, context = false, run }: { actions: MenuAction[]; context?: boolean; run: (action: MenuAction) => void }) {
  const Item = context ? ContextMenuItem : DropdownMenuItem
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator
  return actions.map((action) => (
    <Fragment key={action.id}>
      {action.separatorBefore && <Separator />}
      <Item variant={action.danger ? 'destructive' : 'default'} disabled={action.disabled} onSelect={() => run(action)}>
        {action.icon}<span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{action.label}</span>
      </Item>
    </Fragment>
  ))
}

export function ActionMenu({ actions, trigger, label }: { actions: MenuAction[]; trigger: ReactElement; label: string }) {
  const menu = useMenuAction()
  return (
    <DropdownMenu>
      <Tooltip content={label}><DropdownMenuTrigger asChild ref={menu.triggerRef}>{trigger}</DropdownMenuTrigger></Tooltip>
      <DropdownMenuContent className="w-max min-w-36 max-w-(--radix-dropdown-menu-content-available-width)" collisionPadding={8} loop align="end" onCloseAutoFocus={menu.onCloseAutoFocus}>
        <ActionItems actions={actions} run={(action) => action.afterClose ? menu.runAfterClose(action.onSelect) : action.onSelect()} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type RowActionMenuProps = {
  actions: MenuAction[]
  children: (trigger: ReactNode, open: boolean) => ReactElement
  triggerLabel?: string
  triggerClassName?: string
  disabled?: boolean
  testId?: string
  hint?: string
}

export function RowActionMenu({ actions, children, triggerLabel, triggerClassName, disabled, testId, hint }: RowActionMenuProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const contextReturnFocus = useRef<HTMLElement | null>(null)
  const menu = useMenuAction()
  const run = (action: MenuAction) => action.afterClose ? menu.runAfterClose(action.onSelect) : action.onSelect()
  if (disabled) return children(null, false)

  const trigger = triggerLabel ? (
    <Tooltip content={triggerLabel}>
      <DropdownMenuTrigger asChild>
        <Button ref={menu.triggerRef} variant="ghost" size="icon-sm" aria-label={triggerLabel} className={triggerClassName}>
          <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
    </Tooltip>
  ) : null

  const region = (
    <ContextMenuTrigger asChild onContextMenu={(event) => {
      const active = event.target instanceof Element ? event.target.closest('button, [tabindex]') : null
      contextReturnFocus.current = active instanceof HTMLElement ? active : event.currentTarget.querySelector('button')
      if (!triggerLabel) menu.triggerRef.current = event.currentTarget.querySelector('button')
    }} onKeyDown={(event) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: bounds.left, clientY: bounds.bottom }))
    }}>
      {children(trigger, dropdownOpen || contextOpen)}
    </ContextMenuTrigger>
  )

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <ContextMenu onOpenChange={setContextOpen}>
        {hint ? <Tooltip content={hint}>{region}</Tooltip> : region}
        <ContextMenuContent className="w-max min-w-36 max-w-(--radix-context-menu-content-available-width)" collisionPadding={8} loop data-testid={testId} onCloseAutoFocus={(event) => {
          menu.onCloseAutoFocus(event)
          if (!event.defaultPrevented && contextReturnFocus.current?.isConnected) {
            event.preventDefault()
            contextReturnFocus.current.focus()
          }
        }}>
          <ActionItems actions={actions} context run={run} />
        </ContextMenuContent>
      </ContextMenu>
      <DropdownMenuContent className="w-max min-w-36 max-w-(--radix-dropdown-menu-content-available-width)" collisionPadding={8} loop align="end" data-testid={testId} onCloseAutoFocus={menu.onCloseAutoFocus}>
        <ActionItems actions={actions} run={run} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
