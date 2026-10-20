import type { CSSProperties } from 'react'
import { PanelLeft } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'

/**
 * The desktop app's one sidebar toggle, in the window's title row. It stays in
 * the same place whether the sidebar is open or hidden: on macOS right of the
 * traffic lights, elsewhere at the left of the top strip.
 */
export function TitlebarSidebarToggle({ className = '', style }: { className?: string; style?: CSSProperties }) {
  const t = useTranslation()
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  // It sits above the settings overlay with the window controls; while settings
  // is open it would toggle the sidebar hidden behind it.
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const label = sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')

  return (
    <button
      type="button"
      data-testid="titlebar-sidebar-toggle"
      onClick={toggleSidebar}
      aria-label={label}
      aria-expanded={sidebarOpen}
      aria-controls="sidebar-shell"
      title={label}
      disabled={settingsOpen}
      style={style}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:invisible ${className}`}
    >
      <PanelLeft size={17} strokeWidth={1.9} aria-hidden="true" />
    </button>
  )
}
