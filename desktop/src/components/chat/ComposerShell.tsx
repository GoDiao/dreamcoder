import { useRef, type DragEventHandler, type ReactNode, type RefObject, type TextareaHTMLAttributes } from 'react'
import { ArrowUp, Paperclip, Plus, Square } from 'lucide-react'
import { POPOVER_CLASS } from '../controls/controlStyles'
import { useMenuNavigation } from '../../hooks/useMenuNavigation'

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
  menuRef: RefObject<HTMLDivElement>
}

type ActionProps = {
  mode: 'send' | 'stop'
  disabled: boolean
  onClick: () => void
  label: string
  title?: string
}

type ComposerBoxProps = {
  panelRef: RefObject<HTMLDivElement>
  testId: string
  isDragActive?: boolean
  dragHandlers?: DragHandlers
  /** Absolutely positioned layers anchored to the box (drop overlay, slash menu, file search). */
  overlays?: ReactNode
  plusMenu?: PlusMenuProps
  textareaRef: RefObject<HTMLTextAreaElement>
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
  const iconButtonSize = mobile ? 'h-11 w-11 rounded-xl' : 'h-8 w-8 rounded-lg'
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

      {plusMenu && <ComposerPlusMenu {...plusMenu} iconButtonSize={iconButtonSize} mobile={mobile} />}

      <textarea
        ref={textareaRef}
        rows={1}
        {...textareaProps}
        className={`block min-h-8 min-w-0 flex-1 resize-none self-center border-0 bg-transparent py-[5px] text-ui-message leading-[22px] text-[var(--color-text-primary)] shadow-none outline-none ring-0 placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-0 focus-visible:outline-none disabled:opacity-50 ${
          plusMenu ? '' : 'pl-1.5'
        }`}
        style={{ maxHeight: COMPOSER_TEXTAREA_MAX_HEIGHT, fontFamily: 'var(--font-body)' }}
      />

      <button
        type="button"
        onClick={action.onClick}
        disabled={action.disabled}
        aria-label={action.label}
        title={action.title ?? action.label}
        className={`inline-flex shrink-0 items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] disabled:cursor-not-allowed ${
          mobile ? 'h-11 w-11' : 'h-8 w-8'
        } ${
          actionActive
            ? 'bg-[image:var(--gradient-btn-primary)] text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] hover:brightness-105'
            : 'bg-transparent text-[var(--color-text-tertiary)]'
        }`}
      >
        <ActionIcon
          size={action.mode === 'stop' ? 12 : 16}
          strokeWidth={2.25}
          fill={action.mode === 'stop' ? 'currentColor' : 'none'}
          aria-hidden="true"
        />
      </button>
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

const PLUS_MENU_ITEM_CLASS = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui-body text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]'

function ComposerPlusMenu({
  open,
  onToggle,
  onClose,
  onAddFiles,
  onSlashCommands,
  addFilesLabel,
  slashCommandsLabel,
  toggleLabel,
  menuRef,
  iconButtonSize,
  mobile,
}: PlusMenuProps & { iconButtonSize: string; mobile: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { onKeyDown } = useMenuNavigation({ openKey: open, menuRef: listRef, onClose, triggerRef })

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-label={toggleLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center justify-center text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${iconButtonSize}`}
      >
        <Plus size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={listRef}
          role="menu"
          onKeyDown={onKeyDown}
          className={`absolute bottom-full left-0 z-50 mb-2 p-1 ${POPOVER_CLASS} ${mobile ? 'w-[min(240px,calc(100vw-32px))]' : 'w-[220px]'}`}
        >
          <button type="button" role="menuitem" onClick={onAddFiles} className={PLUS_MENU_ITEM_CLASS}>
            <Paperclip size={15} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
            <span>{addFilesLabel}</span>
          </button>
          <button type="button" role="menuitem" onClick={onSlashCommands} className={PLUS_MENU_ITEM_CLASS}>
            <span className="w-[15px] shrink-0 text-center font-semibold text-[var(--color-text-secondary)]" aria-hidden="true">/</span>
            <span>{slashCommandsLabel}</span>
          </button>
        </div>
      )}
    </div>
  )
}
