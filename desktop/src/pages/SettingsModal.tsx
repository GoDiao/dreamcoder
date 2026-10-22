import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'
import { useEscapeLayer } from '../components/shared/Modal'
import { Spinner } from '../components/shared/Spinner'

const Settings = lazy(() => import('./Settings').then((m) => ({ default: m.Settings })))

const MODAL_EXIT_MS = 180

/** Settings window over the current page, driven by uiStore.settingsOpen / settingsTab. */
export function SettingsModal() {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const [mounted, setMounted] = useState(settingsOpen)
  const [visible, setVisible] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const t = useTranslation()

  useEscapeLayer(settingsOpen, closeSettings)

  // Remember the opener synchronously, before the page behind the window turns inert.
  useEffect(() => useUIStore.subscribe((state, prev) => {
    if (!state.settingsOpen || prev.settingsOpen) return
    const active = document.activeElement
    returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null
  }), [])

  useEffect(() => {
    if (settingsOpen) {
      setMounted(true)
      const frame = window.requestAnimationFrame(() => setVisible(true))
      return () => window.cancelAnimationFrame(frame)
    }
    setVisible(false)
    const opener = returnFocusRef.current
    returnFocusRef.current = null
    // The opener can unmount while the window is open (e.g. a menu item); fall back to the composer.
    if (opener?.isConnected) opener.focus()
    else if (opener) document.querySelector<HTMLElement>('textarea:not([disabled])')?.focus()
    const timer = window.setTimeout(() => setMounted(false), MODAL_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [settingsOpen])

  useEffect(() => {
    if (settingsOpen && mounted) panelRef.current?.focus()
  }, [mounted, settingsOpen])

  if (!mounted) return null

  return createPortal(
    <div
      data-testid="settings-overlay"
      className={`fixed inset-0 z-50 flex items-center justify-center p-8 max-[700px]:p-2.5${settingsOpen ? '' : ' pointer-events-none'}`}
    >
      <div
        aria-hidden="true"
        className="motion-modal-backdrop absolute inset-0 bg-[var(--color-overlay-scrim)]"
        data-state={visible ? 'open' : 'closed'}
        onClick={closeSettings}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        tabIndex={-1}
        data-state={visible ? 'open' : 'closed'}
        className="motion-modal-panel relative flex h-[min(700px,100%)] w-[min(1000px,100%)] overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-dropdown)] outline-none"
      >
        <button
          type="button"
          onClick={closeSettings}
          aria-label={t('settings.close')}
          title={t('settings.close')}
          className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
        >
          <X size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <Suspense fallback={<SettingsLoading />}>
          <Settings />
        </Suspense>
      </section>
    </div>,
    document.body,
  )
}

function SettingsLoading() {
  const t = useTranslation()
  return (
    <div
      role="status"
      aria-label={t('common.loading')}
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-tertiary)]"
    >
      <Spinner size={16} />
    </div>
  )
}
