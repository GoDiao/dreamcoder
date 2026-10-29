import { useState, useEffect, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { computerUseApi } from '../../api/computerUse'
import type { PermissionMode } from '../../types/settings'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import { MobileBottomSheet } from '../shared/MobileBottomSheet'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Tooltip } from '../shared/Tooltip'
import { Check, ChevronDown, FilePenLine, Folder, NotebookPen, ShieldCheck, TriangleAlert, Zap, type LucideIcon } from 'lucide-react'
import { useMenuAction } from '../../hooks/useMenuAction'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../shared/ui/dropdown-menu'
import { Button } from '../shared/ui/button'
import { PICKER_TRIGGER_CLASS } from './controlStyles'

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
  disabled?: boolean
  value: PermissionMode
  effectiveValue?: PermissionMode
  onChange: (mode: PermissionMode) => void
}

export function PermissionModeSelector({ workDir: workDirProp, compact = false, disabled = false, value: currentMode, effectiveValue, onChange }: Props) {
  const t = useTranslation()
  const isMobile = useMobileViewport() && !isDesktopRuntime()
  const defaultMode = useSettingsStore((s) => s.permissionMode)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessions = useSessionStore((s) => s.sessions)
  const [open, setOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const [computerUseEnabled, setComputerUseEnabled] = useState(false)
  const menu = useMenuAction()
  const closeMenu = useCallback(() => setOpen(false), [])

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

  const Option = isMobile ? Button : DropdownMenuRadioItem
  const permissionOptions = PERMISSION_ITEMS.map((item) => {
    const Icon = MODE_ICONS[item.value]
    const selected = item.value === currentMode
    return (
      <Option
        key={item.value}
        value={item.value}
        {...(isMobile ? { role: 'radio', 'aria-checked': selected } : {})}
        onClick={() => {
          if (item.value === 'bypassPermissions') {
            setOpen(false)
            menu.runAfterClose(() => setConfirmDialog(true))
            return
          }
          onChange(item.value)
          setOpen(false)
        }}
        className={`items-start text-ui-foreground focus-visible:bg-[var(--color-surface-hover)] ${
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
        {isMobile && selected && <Check size={14} className="mt-1 shrink-0 text-[var(--color-text-primary)]" aria-hidden="true" />}
      </Option>
    )
  })

  const pendingNote = effectiveValue && effectiveValue !== currentMode
    ? t('permMode.pendingSwitch', { mode: MODE_LABELS[currentMode] })
    : undefined

  const trigger = (
      <Button
        ref={menu.triggerRef}
        disabled={disabled}
        variant="ghost"
        type="button"
        aria-label={MODE_LABELS[currentMode]}
        {...(isMobile ? { onClick: () => setOpen(!open), 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': open ? menuId : undefined } : {})}
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
      </Button>
  )

  return (
    <>
      {isMobile ? <>
        {trigger}
        <MobileBottomSheet open={open} onClose={closeMenu} onExited={menu.afterClose} title={t('permMode.executionPermissions')} contentClassName="p-2">
          <div id={menuId} role="radiogroup" aria-label={t('permMode.executionPermissions')}>{permissionOptions}</div>
        </MobileBottomSheet>
      </> : (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <Tooltip content={pendingNote ?? (compact ? MODE_LABELS[currentMode] : undefined)}>
            <DropdownMenuTrigger asChild disabled={disabled}>{trigger}</DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent aria-label={t('permMode.executionPermissions')} side="top" align="start" className="w-[300px]" onCloseAutoFocus={menu.onCloseAutoFocus}>
            <DropdownMenuRadioGroup value={currentMode}>{permissionOptions}</DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ConfirmDialog
        open={confirmDialog}
        onClose={closeConfirmDialog}
        onConfirm={() => { onChange('bypassPermissions'); setConfirmDialog(false) }}
        title={t('permMode.enableBypassTitle')}
        confirmLabel={t('permMode.enableBypassBtn')}
        cancelLabel={t('common.cancel')}
        body={<>
          <p className="mb-3 text-ui-muted-foreground">{t('permMode.enableBypassSubtitle')}</p>
        <div>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-3" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('permMode.enableBypassBody')) }} />
          <Tooltip content={workDir}><div tabIndex={0} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface-container)] border border-[var(--color-border)]">
            <Folder size={16} className="shrink-0 text-ui-muted-foreground" aria-hidden="true" />
            <code className="text-xs font-[var(--font-mono)] text-[var(--color-text-primary)] truncate">{workDir}</code>
          </div></Tooltip>
          <ul className="mt-3 space-y-1.5 text-xs text-[var(--color-text-secondary)]">
            <li className="flex items-start gap-2">
              <Check size={14} className="mt-0.5 text-ui-destructive" aria-hidden="true" />
              {t('permMode.permReadWrite')}
            </li>
            <li className="flex items-start gap-2">
              <Check size={14} className="mt-0.5 text-ui-destructive" aria-hidden="true" />
              {t('permMode.permShell')}
            </li>
            <li className="flex items-start gap-2">
              <Check size={14} className="mt-0.5 text-ui-destructive" aria-hidden="true" />
              {t('permMode.permPackages')}
            </li>
          </ul>
          {computerUseEnabled ? (
            <p role="note" className="mt-3 flex items-start gap-2 text-xs text-[var(--color-error)]">
              <TriangleAlert size={14} className="mt-0.5" aria-hidden="true" />
              {t('permMode.computerUseBypassWarning')}
            </p>
          ) : null}
        </div>
        </>}
      />
    </>
  )
}
