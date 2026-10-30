import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { type DragEventHandler, type ReactNode, type RefObject, type TextareaHTMLAttributes } from 'react'
import { ArrowUp, Paperclip, Plus, Square } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../shared/ui/dropdown-menu'
import { Textarea } from '../shared/ui/textarea'
import { Button } from '../shared/ui/button'

export const COMPOSER_TEXTAREA_MAX_HEIGHT = 200

type DragHandlers = {
  onDragEnter?: DragEventHandler<HTMLDivElement>
  onDragOver?: DragEventHandler<HTMLDivElement>
  onDragLeave?: DragEventHandler<HTMLDivElement>
  onDrop?: DragEventHandler<HTMLDivElement>
}

type PlusMenuProps = {
  open: boolean
  onToggle: () => void
  onClose: () => void
  onAddFiles: () => void
  onSlashCommands: () => void
  addFilesLabel: string
  slashCommandsLabel: string
  toggleLabel: string
}

type ActionProps = {
  mode: 'send' | 'stop'
  disabled: boolean
  onClick: () => void
  label: string
  title?: string
}

type ComposerBoxProps = {
  panelRef: RefObject<HTMLDivElement | null>
  testId: string
  isDragActive?: boolean
  dragHandlers?: DragHandlers
  /** Absolutely positioned layers anchored to the box (drop overlay, slash menu, file search). */
  overlays?: ReactNode
  plusMenu?: PlusMenuProps
  textareaRef: RefObject<HTMLTextAreaElement | null>
  textareaProps: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows' | 'className'>
  action: ActionProps
  mobile?: boolean
}

/** One rounded input box: "+" menu on the left, auto-growing single-line text, icon send/stop on the right. */
export function ComposerBox({
  panelRef,
  testId,
  isDragActive = false,
  dragHandlers,
  overlays,
  plusMenu,
  textareaRef,
  textareaProps,
  action,
  mobile = false,
}: ComposerBoxProps) {
  const ActionIcon = action.mode === 'stop' ? Square : ArrowUp
  const actionActive = action.mode === 'stop' || !action.disabled

  return (
    <div
      ref={panelRef}
      data-testid={testId}
      className={`glass-panel relative flex items-end gap-1.5 overflow-visible rounded-2xl px-2 py-1.5 transition-colors ${
        isDragActive ? 'composer-drop-target-active' : ''
      }`}
      {...dragHandlers}
    >
      {overlays}

      <Textarea
        ref={textareaRef}
        rows={1}
        {...textareaProps}
        className={`block min-h-8 min-w-0 flex-1 resize-none self-center border-0 bg-transparent py-[5px] text-ui-message leading-[22px] text-[var(--color-text-primary)] shadow-none outline-none ring-0 placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus-visible:ring-0 focus-visible:outline-none disabled:opacity-50 ${
          plusMenu ? '' : 'pl-1.5'
        }`}
        style={{ maxHeight: COMPOSER_TEXTAREA_MAX_HEIGHT, fontFamily: 'var(--font-body)' }}
      />

      {plusMenu && <ComposerPlusMenu {...plusMenu} mobile={mobile} />}

      <HintTooltip content={action.title ?? action.label}><Button
        variant={actionActive ? 'gradient' : 'ghost'}
        size={mobile ? 'icon-xl' : 'icon'}
        type="button"
        onClick={action.onClick}
        disabled={action.disabled}
        aria-label={action.label}
        className={`rounded-full ${actionActive ? '' : 'text-[var(--color-text-tertiary)]'}`}
      >
        <ActionIcon
          size={action.mode === 'stop' ? 12 : 16}
          strokeWidth={2.25}
          fill={action.mode === 'stop' ? 'currentColor' : 'none'}
          aria-hidden="true"
        />
      </Button></HintTooltip>
    </div>
  )
}

type ComposerControlsProps = {
  left?: ReactNode
  right?: ReactNode
  testId?: string
}

/** The row below the input box: project and permission on the left, model and context on the right. */
export function ComposerControls({ left, right, testId = 'composer-controls' }: ComposerControlsProps) {
  return (
    <div
      data-testid={testId}
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-2.5 gap-y-1 px-1 pt-1.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-0.5">{left}</div>
      <div className="ml-auto flex min-w-0 items-center gap-0.5">{right}</div>
    </div>
  )
}

/** Auto-grows a textarea from one line up to the composer's max height. */
export function resizeComposerTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`
}


function ComposerPlusMenu({
  open,
  onToggle,
  onClose,
  onAddFiles,
  onSlashCommands,
  addFilesLabel,
  slashCommandsLabel,
  toggleLabel,
  mobile,
}: PlusMenuProps & { mobile: boolean }) {
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={(next) => { if (next) onToggle(); else onClose() }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={mobile ? 'icon-xl' : 'icon'} aria-label={toggleLabel} className={mobile ? 'order-first rounded-xl' : 'order-first'}>
          <Plus size={18} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        loop
        side="top"
        align="start"
        sideOffset={8}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          if (document.activeElement && document.activeElement !== document.body) event.preventDefault()
        }}
        className={mobile ? 'w-[min(240px,calc(100vw-32px))]' : 'w-[220px]'}
      >
        <DropdownMenuItem onSelect={onAddFiles}>
          <Paperclip aria-hidden="true" />{addFilesLabel}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSlashCommands}>
          <span aria-hidden="true">/</span>{slashCommandsLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
