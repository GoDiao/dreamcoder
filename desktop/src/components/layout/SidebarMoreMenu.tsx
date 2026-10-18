import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Ellipsis, Folders, Globe, Keyboard, Settings2 } from 'lucide-react'
import { useTranslation, type Locale } from '../../i18n'
import { useMenuNavigation } from '../../hooks/useMenuNavigation'
import { useSettingsStore } from '../../stores/settingsStore'

const LANGUAGE_OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

const MENU_WIDTH = 240

type SidebarMoreMenuProps = {
  collapsed: boolean
  onOpenProjectManagement: () => void
  onOpenSettings: () => void
  onOpenShortcuts: () => void
}

/** Bottom-left "More" trigger with an upward menu for low-frequency entries. */
export function SidebarMoreMenu({
  collapsed,
  onOpenProjectManagement,
  onOpenSettings,
  onOpenShortcuts,
}: SidebarMoreMenuProps) {
  const t = useTranslation()
  const locale = useSettingsStore((s) => s.locale)
  const [view, setView] = useState<'main' | 'language' | null>(null)
  const [position, setPosition] = useState<{ left: number; bottom: number }>({ left: 8, bottom: 56 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = view !== null
  const currentLanguage = LANGUAGE_OPTIONS.find((option) => option.value === locale)?.label ?? locale

  const close = useCallback((restoreFocus = false) => {
    setView(null)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])
  const closeMenu = useCallback(() => close(), [close])
  const { onKeyDown, closeAndRestoreFocus } = useMenuNavigation({
    openKey: open,
    menuRef,
    onClose: closeMenu,
    triggerRef,
    focusKey: view,
  })

  useEffect(() => {
    if (!open) return
    const handleClick = () => close()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close(true)
    }
    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [close, open])

  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (open) {
      close()
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const width = collapsed ? MENU_WIDTH : Math.max(rect.width, 200)
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      bottom: Math.max(8, window.innerHeight - rect.top + 6),
    })
    setView('main')
  }

  // Focus is back on the trigger before the action runs, so a dialog it opens restores focus there.
  const run = (action: () => void) => {
    closeAndRestoreFocus()
    action()
  }

  const menuWidth = collapsed ? MENU_WIDTH : (triggerRef.current?.getBoundingClientRect().width || MENU_WIDTH)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('sidebar.more')}
        title={collapsed ? t('sidebar.more') : undefined}
        className={`flex items-center text-ui-nav transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
          collapsed ? 'h-10 w-10 justify-center rounded-[var(--radius-md)]' : 'h-9 w-full gap-2.5 rounded-lg px-2.5'
        } ${
          open
            ? 'bg-[var(--color-sidebar-item-active)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <Ellipsis className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
        {!collapsed && <span className="truncate">{t('sidebar.more')}</span>}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={view === 'language' ? t('sidebar.language') : t('sidebar.more')}
          data-testid="sidebar-more-menu"
          className="motion-menu fixed z-50 overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]"
          data-state="open"
          style={{ left: position.left, bottom: position.bottom, width: menuWidth }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          {view === 'main' ? (
            <>
              <MoreMenuItem icon={<Folders size={16} aria-hidden="true" />} onClick={() => run(onOpenProjectManagement)}>
                {t('sidebar.projectManagement')}
              </MoreMenuItem>
              <MoreMenuItem icon={<Settings2 size={16} aria-hidden="true" />} onClick={() => run(onOpenSettings)}>
                {t('sidebar.settings')}
              </MoreMenuItem>
              <MoreMenuItem
                icon={<Globe size={16} aria-hidden="true" />}
                trailing={<ChevronRight size={14} aria-hidden="true" />}
                aria-haspopup="menu"
                onClick={() => setView('language')}
              >
                {`Language · ${currentLanguage}`}
              </MoreMenuItem>
              <MoreMenuItem icon={<Keyboard size={16} aria-hidden="true" />} onClick={() => run(onOpenShortcuts)}>
                {t('sidebar.shortcuts')}
              </MoreMenuItem>
            </>
          ) : (
            <>
              {LANGUAGE_OPTIONS.map((option) => (
                <MoreMenuItem
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={locale === option.value}
                  icon={<Check size={16} aria-hidden="true" className={locale === option.value ? '' : 'invisible'} />}
                  onClick={() => {
                    useSettingsStore.getState().setLocale(option.value)
                    close(true)
                  }}
                >
                  {option.label}
                </MoreMenuItem>
              ))}
              <div className="my-1 h-px bg-[var(--color-border-separator)]" role="separator" />
              <MoreMenuItem icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={() => setView('main')}>
                {t('sidebar.backToMore')}
              </MoreMenuItem>
            </>
          )}
        </div>
      )}
    </>
  )
}

function MoreMenuItem({
  icon,
  trailing,
  children,
  onClick,
  role = 'menuitem',
  ...aria
}: {
  icon: React.ReactNode
  trailing?: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  role?: 'menuitem' | 'menuitemradio'
  'aria-checked'?: boolean
  'aria-haspopup'?: 'menu'
}) {
  return (
    <button
      type="button"
      role={role}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-ui-nav text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)] focus-visible:outline-none"
      {...aria}
    >
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--color-text-secondary)]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing && <span className="flex-shrink-0 text-[var(--color-text-tertiary)]">{trailing}</span>}
    </button>
  )
}
