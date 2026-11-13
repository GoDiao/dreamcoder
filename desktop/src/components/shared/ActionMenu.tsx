import { Fragment, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { useMenuAction } from '../../hooks/useMenuAction'
import { Tooltip } from './Tooltip'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from './ui/context-menu'

export type MenuAction = {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  heading?: string
  afterClose?: boolean
}

export type MenuChoiceGroup = {
  id: string
  label: string
  icon?: ReactNode
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  separatorBefore?: boolean
}

export type MenuSubmenu = {
  id: string
  label: string
  icon?: ReactNode
  items: MenuAction[]
  separatorBefore?: boolean
}

export type MenuEntry = MenuAction | MenuChoiceGroup | MenuSubmenu

function ChoiceSubmenu({ group }: { group: MenuChoiceGroup }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {group.icon}<span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{group.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent collisionPadding={8}>
        <DropdownMenuRadioGroup value={group.value} onValueChange={group.onChange}>
          {group.options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function ActionItems({ actions, context = false, run }: { actions: MenuEntry[]; context?: boolean; run: (action: MenuAction) => void }) {
  const Item = context ? ContextMenuItem : DropdownMenuItem
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator
  const Label = context ? ContextMenuLabel : DropdownMenuLabel
  const Sub = context ? ContextMenuSub : DropdownMenuSub
  const SubTrigger = context ? ContextMenuSubTrigger : DropdownMenuSubTrigger
  const SubContent = context ? ContextMenuSubContent : DropdownMenuSubContent
  return actions.map((action) => (
    <Fragment key={action.id}>
      {action.separatorBefore && <Separator />}
      {'heading' in action && action.heading && <Label>{action.heading}</Label>}
      {'options' in action ? (
        <ChoiceSubmenu group={action} />
      ) : 'items' in action ? (
        <Sub>
          <SubTrigger>
            {action.icon}<span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{action.label}</span>
          </SubTrigger>
          <SubContent collisionPadding={8}>
            <ActionItems actions={action.items} context={context} run={run} />
          </SubContent>
        </Sub>
      ) : (
        <Item variant={action.danger ? 'destructive' : 'default'} disabled={action.disabled} onSelect={() => run(action)}>
          {action.icon}<span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{action.label}</span>
        </Item>
      )}
    </Fragment>
  ))
}

export function ActionMenu({ actions, trigger, label }: { actions: MenuEntry[]; trigger: ReactElement; label: string }) {
  const menu = useMenuAction()
  return (
    <DropdownMenu>
      <Tooltip content={label}><DropdownMenuTrigger asChild ref={menu.triggerRef}>{trigger}</DropdownMenuTrigger></Tooltip>
      <DropdownMenuContent {...dropdownContentProps} align="end" onCloseAutoFocus={menu.onCloseAutoFocus}>
        <ActionItems actions={actions} run={(action) => action.afterClose ? menu.runAfterClose(action.onSelect) : action.onSelect()} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const menuContentProps = { collisionPadding: 8, loop: true }
const dropdownContentProps = { ...menuContentProps, className: 'w-max min-w-36 max-w-(--radix-dropdown-menu-content-available-width)' }

export function AnchoredActionMenu({ actions, anchor, label, onClose, contentProps }: {
  actions: MenuEntry[]
  anchor: { left: number; top: number; width: number; height: number }
  label: string
  onClose: () => void
  contentProps?: Record<`data-${string}`, string>
}) {
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => { if (!open) onClose() }}>
      {createPortal(
        <DropdownMenuTrigger asChild>
          <span aria-hidden="true" className="pointer-events-none fixed" style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }} />
        </DropdownMenuTrigger>,
        document.body,
      )}
      <DropdownMenuContent aria-label={label} aria-labelledby={undefined} {...dropdownContentProps} align="start" onCloseAutoFocus={(event) => event.preventDefault()} {...contentProps}>
        <ActionItems actions={actions} run={(action) => action.onSelect()} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type RowActionMenuProps = {
  actions: MenuEntry[]
  children: (trigger: ReactNode, open: boolean) => ReactElement
  triggerLabel?: string
  disabled?: boolean
  testId?: string
  hint?: string
  selectable?: boolean
}

export function RowActionMenu({ actions, children, triggerLabel, disabled, testId, hint, selectable }: RowActionMenuProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const contextReturnFocus = useRef<HTMLElement | null>(null)
  const menu = useMenuAction()
  const run = (action: MenuAction) => action.afterClose ? menu.runAfterClose(action.onSelect) : action.onSelect()
  if (disabled) return children(null, false)

  const trigger = triggerLabel ? (
    <Tooltip content={triggerLabel}>
      <DropdownMenuTrigger asChild>
        <Button ref={menu.triggerRef} variant="ghost-muted" size="icon-sm" aria-label={triggerLabel}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
    </Tooltip>
  ) : null

  const region = (
    <ContextMenuTrigger asChild selectable={selectable} onContextMenu={(event) => {
      const active = event.target instanceof Element ? event.target.closest('button, [tabindex]') : null
      const rowButton = selectable ? null : event.currentTarget.querySelector('button')
      contextReturnFocus.current = active instanceof HTMLElement ? active : rowButton
      if (!triggerLabel) menu.triggerRef.current = rowButton
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
        <ContextMenuContent className="w-max min-w-36 max-w-(--radix-context-menu-content-available-width)" {...menuContentProps} data-testid={testId} onCloseAutoFocus={(event) => {
          menu.onCloseAutoFocus(event)
          if (!event.defaultPrevented && contextReturnFocus.current?.isConnected) {
            event.preventDefault()
            contextReturnFocus.current.focus()
          }
        }}>
          <ActionItems actions={actions} context run={run} />
        </ContextMenuContent>
      </ContextMenu>
      <DropdownMenuContent {...dropdownContentProps} align="end" data-testid={testId} onCloseAutoFocus={menu.onCloseAutoFocus}>
        <ActionItems actions={actions} run={run} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
