import { useState, useRef, useEffect, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { createPortal } from 'react-dom'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { computerUseApi } from '../../api/computerUse'
import type { PermissionMode } from '../../types/settings'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { MobileBottomSheet } from '../shared/MobileBottomSheet'
import { Check, ChevronDown, FilePenLine, NotebookPen, ShieldCheck, Zap, type LucideIcon } from 'lucide-react'
import { PICKER_TRIGGER_CLASS, POPOVER_CLASS } from './controlStyles'

const MODE_ICONS: Record<PermissionMode, LucideIcon> = {
  default: ShieldCheck,
  acceptEdits: FilePenLine,
  plan: NotebookPen,
  bypassPermissions: Zap,
  dontAsk: Zap,
}

type Props = {
  workDir?: string
  compact?: boolean
  value: PermissionMode
  effectiveValue?: PermissionMode
  onChange: (mode: PermissionMode) => void
}

export function PermissionModeSelector({ workDir: workDirProp, compact = false, value: currentMode, effectiveValue, onChange }: Props) {
  const t = useTranslation()
  const isMobile = useMobileViewport() && !isDesktopRuntime()
  const defaultMode = useSettingsStore((s) => s.permissionMode)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessions = useSessionStore((s) => s.sessions)
  const [open, setOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [confirmMounted, setConfirmMounted] = useState(false)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [computerUseEnabled, setComputerUseEnabled] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)


  const PERMISSION_ITEMS: Array<{
    value: PermissionMode
    label: string
    description: string
    color?: string
  }> = [
    {
      value: 'default',
      label: t('permMode.label.default'),
      description: t('permMode.askPermDesc'),
    },
    {
      value: 'acceptEdits',
      label: t('permMode.label.acceptEdits'),
      description: t('permMode.autoAcceptDesc'),
    },
    {
      value: 'plan',
      label: t('permMode.label.plan'),
      description: t('permMode.planModeDesc'),
    },
    {
      value: 'bypassPermissions',
      label: t('permMode.label.bypassPermissions'),
      description: t('permMode.bypassDesc'),
      color: 'text-[var(--color-error)]',
    },
  ]

  const MODE_LABELS: Record<PermissionMode, string> = {
    default: t('permMode.label.default'),
    acceptEdits: t('permMode.label.acceptEdits'),
    plan: t('permMode.label.plan'),
    bypassPermissions: t('permMode.label.bypassPermissions'),
    dontAsk: t('permMode.label.dontAsk'),
  }

  const activeSession = activeTabId
    ? sessions.find((s) => s.id === activeTabId)
    : null
  const workDir = workDirProp || activeSession?.workDir || '~'
  const compactButtonClass = compact
    ? isMobile
      ? 'h-11 w-11 justify-center rounded-xl p-0'
      : 'w-7 justify-center px-0'
    : ''
  const CurrentIcon = MODE_ICONS[currentMode]
  const menuId = 'permission-mode-menu'

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        ref.current &&
        !ref.current.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Mark handled so an enclosing dialog's Escape layer stays open.
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  useEffect(() => {
    if (confirmDialog) {
      setConfirmMounted(true)
      const frame = window.requestAnimationFrame(() => setConfirmVisible(true))
      return () => window.cancelAnimationFrame(frame)
    }
    setConfirmVisible(false)
    const timer = window.setTimeout(() => setConfirmMounted(false), 180)
    return () => window.clearTimeout(timer)
  }, [confirmDialog])

  // Bypass mode skips the per-call confirmation of Computer Use actions too.
  useEffect(() => {
    if (!confirmDialog) return
    let cancelled = false
    computerUseApi.getConfig()
      .then(config => { if (!cancelled) setComputerUseEnabled(config.enabled) })
      .catch(() => { if (!cancelled) setComputerUseEnabled(false) })
    return () => { cancelled = true }
  }, [confirmDialog])

  const closeConfirmDialog = useCallback(() => setConfirmDialog(false), [])

  const permissionOptions = (
    <div id={menuId} ref={menuRef} role="menu" aria-label={t('permMode.executionPermissions')}>
      {PERMISSION_ITEMS.map((item) => {
        const Icon = MODE_ICONS[item.value]
        const selected = item.value === currentMode
        return (
          <button
            key={item.value}
            role="menuitemradio"
            aria-checked={selected}
            onClick={() => {
              if (item.value === 'bypassPermissions') {
                setOpen(false)
                setConfirmDialog(true)
                return
              }
              onChange(item.value)
              setOpen(false)
            }}
            className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)] ${
              selected ? 'bg-[var(--color-surface-selected)]' : ''
            }`}
          >
            <Icon size={15} className={`mt-0.5 shrink-0 ${item.color || 'text-[var(--color-text-secondary)]'}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-ui-body font-medium text-[var(--color-text-primary)]">
                {item.label}
                {item.value === defaultMode && (
                  <span className="rounded px-1 text-ui-aux font-normal text-[var(--color-text-tertiary)] ring-1 ring-inset ring-[var(--color-border)]">
                    {t('permMode.defaultTag')}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-ui-aux text-[var(--color-text-tertiary)]">{item.description}</div>
            </div>
            {selected && <Check size={14} className="mt-1 shrink-0 text-[var(--color-text-primary)]" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )

  const pendingNote = effectiveValue && effectiveValue !== currentMode
    ? t('permMode.pendingSwitch', { mode: MODE_LABELS[currentMode] })
    : undefined

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={MODE_LABELS[currentMode]}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={pendingNote ?? (compact ? MODE_LABELS[currentMode] : undefined)}
        className={`${PICKER_TRIGGER_CLASS} ${compactButtonClass}`}
      >
        <CurrentIcon size={14} className="shrink-0" aria-hidden="true" />
        {pendingNote && (
          <span
            data-testid="permission-mode-pending"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)] animate-pulse-dot"
            aria-hidden="true"
          />
        )}
        {!compact && (
          <>
            <span className="truncate">{MODE_LABELS[currentMode]}</span>
            <ChevronDown size={13} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          </>
        )}
      </button>

      {open && (
        isMobile ? (
          <MobileBottomSheet
            open={open}
            onClose={() => setOpen(false)}
            title={t('permMode.executionPermissions')}
            closeLabel={t('tabs.close')}
            ariaLabel={t('permMode.executionPermissions')}
            contentClassName="p-2"
          >
            {permissionOptions}
          </MobileBottomSheet>
        ) : (
          <div className={`motion-menu absolute bottom-full left-0 z-50 mb-2 w-[300px] p-1 ${POPOVER_CLASS}`} data-state="open">
            {permissionOptions}
          </div>
        )
      )}

      {confirmMounted && createPortal(
        <div className={`motion-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/40 ${isMobile ? 'px-4' : 'pl-[var(--sidebar-width)] pr-4'}`} data-state={confirmVisible ? 'open' : 'closed'} onClick={closeConfirmDialog}>
          <div
            className={`motion-modal-panel ${isMobile ? 'w-full max-w-md' : 'w-[420px]'} overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]`}
            data-state={confirmVisible ? 'open' : 'closed'}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 py-4 bg-[var(--color-error)]/8 border-b border-[var(--color-error)]/15">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--color-error)]/12">
                <span className="material-symbols-outlined text-[22px] text-[var(--color-error)]">warning</span>
              </div>
              <div>
                <div className="text-sm font-bold text-[var(--color-text-primary)]">{t('permMode.enableBypassTitle')}</div>
                <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{t('permMode.enableBypassSubtitle')}</div>
              </div>
            </div>

            <div className="px-5 py-4">
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-3" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('permMode.enableBypassBody')) }} />
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface-container)] border border-[var(--color-border)]" title={workDir}>
                <span className="material-symbols-outlined text-[16px] text-[var(--color-text-tertiary)] shrink-0">folder</span>
                <code className="text-xs font-[var(--font-mono)] text-[var(--color-text-primary)] truncate">{workDir}</code>
              </div>
              <ul className="mt-3 space-y-1.5 text-xs text-[var(--color-text-secondary)]">
                <li className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-[14px] text-[var(--color-error)] mt-0.5">check</span>
                  {t('permMode.permReadWrite')}
                </li>
                <li className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-[14px] text-[var(--color-error)] mt-0.5">check</span>
                  {t('permMode.permShell')}
                </li>
                <li className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-[14px] text-[var(--color-error)] mt-0.5">check</span>
                  {t('permMode.permPackages')}
                </li>
              </ul>
              {computerUseEnabled ? (
                <p role="note" className="mt-3 flex items-start gap-2 text-xs text-[var(--color-error)]">
                  <span className="material-symbols-outlined text-[14px] mt-0.5">warning</span>
                  {t('permMode.computerUseBypassWarning')}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
              <button
                onClick={closeConfirmDialog}
                className="px-4 py-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  onChange('bypassPermissions')
                  setConfirmDialog(false)
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-[var(--color-error)] hover:opacity-90 rounded-lg transition-colors"
              >
                {t('permMode.enableBypassBtn')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
