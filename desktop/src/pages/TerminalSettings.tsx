import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { Eraser, Info, RotateCcw } from 'lucide-react'
import { useTranslation, type TranslationKey } from '../i18n'
import { terminalApi } from '../api/terminal'
import {
  attachTerminalRuntime,
  createLocalTerminalRuntimeId,
  destroyTerminalRuntime,
  getTerminalRuntime,
  subscribeTerminalRuntime,
  updateTerminalRuntime,
  type TerminalRuntime,
  type TerminalStatus,
} from '../lib/terminalRuntime'

const STATUS_LABEL_KEYS: Record<TerminalStatus, TranslationKey> = {
  idle: 'settings.terminal.status.idle',
  starting: 'settings.terminal.status.starting',
  running: 'settings.terminal.status.running',
  exited: 'settings.terminal.status.exited',
  error: 'settings.terminal.status.error',
  unavailable: 'settings.terminal.status.unavailable',
}

function findScrollableAncestor(element: HTMLElement, deltaY: number): HTMLElement | null {
  let parent = element.parentElement
  while (parent) {
    const style = window.getComputedStyle(parent)
    const canScrollY = style.overflowY === 'auto' || style.overflowY === 'scroll'
    if (canScrollY && parent.scrollHeight > parent.clientHeight) {
      const maxScrollTop = parent.scrollHeight - parent.clientHeight
      const canMove = deltaY < 0 ? parent.scrollTop > 0 : parent.scrollTop < maxScrollTop
      if (canMove) return parent
    }
    parent = parent.parentElement
  }
  return null
}

type TerminalSettingsProps = {
  active?: boolean
  cwd?: string
  onNewTerminal?: () => void
  testId?: string
  workspace?: boolean
  docked?: boolean
  showPreferences?: boolean
  runtimeId?: string
  preserveOnUnmount?: boolean
  /** Docked only: content placed at the start of the toolbar (the panel's terminal tabs). */
  toolbarLeading?: ReactNode
  /** Docked only: a light line under the toolbar, e.g. "project · branch". */
  meta?: ReactNode
  onShellChange?: (shell: string) => void
}

export function TerminalSettings({
  active = true,
  cwd,
  onNewTerminal,
  testId = 'settings-terminal-host',
  workspace = false,
  docked = false,
  showPreferences = false,
  runtimeId,
  preserveOnUnmount = false,
  toolbarLeading,
  meta,
  onShellChange,
}: TerminalSettingsProps = {}) {
  const t = useTranslation()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const localRuntimeIdRef = useRef<string | null>(null)
  if (!localRuntimeIdRef.current) {
    localRuntimeIdRef.current = runtimeId ?? createLocalTerminalRuntimeId()
  }
  const effectiveRuntimeId = runtimeId ?? localRuntimeIdRef.current
  const runtimeRef = useRef<TerminalRuntime | null>(null)
  if (!runtimeRef.current || runtimeRef.current.id !== effectiveRuntimeId) {
    runtimeRef.current = getTerminalRuntime(effectiveRuntimeId, terminalApi.isAvailable() ? 'idle' : 'unavailable')
  }
  const runtime = runtimeRef.current
  const [, forceRuntimeUpdate] = useState(0)
  const status = runtime.status
  const warning = runtime.warning
  const error = runtime.error
  const shellInfo = runtime.shellInfo
  const isWindows = typeof navigator !== 'undefined'
    && (/^Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent))

  useEffect(() => {
    return subscribeTerminalRuntime(runtime, () => forceRuntimeUpdate((value) => value + 1))
  }, [runtime])

  useEffect(() => {
    if (shellInfo?.shell) onShellChange?.(shellInfo.shell)
  }, [onShellChange, shellInfo?.shell])

  const resizeSession = useCallback(() => {
    const terminal = runtime.terminal
    const fit = runtime.fit
    const sessionId = runtime.nativeSessionId
    if (!terminal || !fit) return

    fit.fit()
    if (sessionId) {
      void terminalApi.resize(sessionId, terminal.cols, terminal.rows).catch(() => {})
    }
  }, [runtime])

  const startTerminal = useCallback(async () => {
    if (!terminalApi.isAvailable()) {
      updateTerminalRuntime(runtime, { status: 'unavailable' })
      return
    }

    const host = hostRef.current
    if (!host) return

    updateTerminalRuntime(runtime, { error: null, warning: null, status: 'starting', shellInfo: null })

    const existing = runtime.nativeSessionId
    if (existing) {
      await terminalApi.kill(existing).catch(() => {})
      runtime.nativeSessionId = null
    }
    runtime.dataDisposable?.dispose()
    runtime.dataDisposable = null
    runtime.unlisteners.forEach((unlisten) => unlisten())
    runtime.unlisteners = []

    runtime.terminal?.dispose()
    runtime.terminal = null
    runtime.fit = null
    host.innerHTML = ''

    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ])

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "var(--font-mono), 'SFMono-Regular', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 4000,
      theme: {
        background: '#121212',
        foreground: '#d7d2d0',
        cursor: '#ffb59f',
        selectionBackground: '#5f4a40',
        black: '#1f1f1f',
        red: '#ff6d67',
        green: '#7ef18a',
        yellow: '#f8c55f',
        blue: '#77a8ff',
        magenta: '#d699ff',
        cyan: '#61d6d6',
        white: '#d7d2d0',
        brightBlack: '#8f8683',
        brightRed: '#ff8a85',
        brightGreen: '#9ff7a7',
        brightYellow: '#ffdd7a',
        brightBlue: '#a6c5ff',
        brightMagenta: '#e3b8ff',
        brightCyan: '#8ceeee',
        brightWhite: '#ffffff',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    updateTerminalRuntime(runtime, { terminal, fit })
    fit.fit()

    const outputUnlisten = await terminalApi.onOutput((payload) => {
      if (payload.session_id === runtime.nativeSessionId) {
        terminal.write(payload.data)
      }
    })
    const exitUnlisten = await terminalApi.onExit((payload) => {
      if (payload.session_id !== runtime.nativeSessionId) return
      updateTerminalRuntime(runtime, { status: 'exited' })
      const signal = payload.signal ? `, ${payload.signal}` : ''
      terminal.writeln(`\r\n[process exited: ${payload.code}${signal}]`)
      updateTerminalRuntime(runtime, { nativeSessionId: null })
    })
    runtime.unlisteners = [outputUnlisten, exitUnlisten]

    runtime.dataDisposable = terminal.onData((data) => {
      const sessionId = runtime.nativeSessionId
      if (sessionId) {
        void terminalApi.write(sessionId, data).catch((err) => {
          updateTerminalRuntime(runtime, {
            error: err instanceof Error ? err.message : String(err),
            status: 'error',
          })
        })
      }
    })

    try {
      const result = await terminalApi.spawn({
        cols: terminal.cols,
        rows: terminal.rows,
        ...(cwd ? { cwd } : {}),
      })
      updateTerminalRuntime(runtime, {
        nativeSessionId: result.session_id,
        shellInfo: { shell: result.shell, cwd: result.cwd },
        warning: result.warning ?? null,
        status: 'running',
      })
      resizeSession()
    } catch (err) {
      outputUnlisten()
      exitUnlisten()
      terminal.dispose()
      updateTerminalRuntime(runtime, {
        terminal: null,
        fit: null,
        error: err instanceof Error ? err.message : String(err),
        status: 'error',
      })
    }
  }, [cwd, resizeSession, runtime])

  useEffect(() => {
    if (!terminalApi.isAvailable()) return
    if (runtime.terminal) {
      if (hostRef.current) {
        attachTerminalRuntime(runtime, hostRef.current)
      }
      resizeSession()
    } else {
      void startTerminal()
    }

    const observer = new ResizeObserver(() => resizeSession())
    if (hostRef.current) observer.observe(hostRef.current)

    return () => {
      observer.disconnect()
      if (!preserveOnUnmount) {
        destroyTerminalRuntime(runtime.id)
      }
    }
  }, [preserveOnUnmount, resizeSession, runtime, startTerminal])

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => resizeSession())
    }
  }, [active, resizeSession])

  const clearTerminal = () => {
    runtime.terminal?.clear()
  }

  const handleTerminalWheelCapture = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const host = hostRef.current
    if (!host || host.contains(document.activeElement)) return

    const scroller = findScrollableAncestor(event.currentTarget, event.deltaY)
    if (!scroller) return

    event.preventDefault()
    event.stopPropagation()
    scroller.scrollBy({ top: event.deltaY, left: event.deltaX })
  }, [])

  const notices = (
    <>
      {error && (
        <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-error)]/20 bg-[var(--color-error)]/10 px-3 py-2 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {warning && (
        <div role="status" className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-terminal-warning)]/30 bg-[var(--color-terminal-warning)]/10 px-3 py-2 text-sm text-[var(--color-text-secondary)]">
          <p>{t('settings.terminal.shellFallback', { shell: shellInfo?.shell ?? '' })}</p>
          <p className="mt-1 text-xs">{warning}</p>
        </div>
      )}
    </>
  )

  const unavailableNotice = (
    <div className="flex flex-1 items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-8 text-center">
      <div>
        <span className="material-symbols-outlined mb-3 block text-[32px] text-[var(--color-text-tertiary)]">
          desktop_windows
        </span>
        <p className="text-sm font-medium text-[var(--color-text-primary)]">
          {t('settings.terminal.unavailableTitle')}
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
          {t('settings.terminal.unavailableBody')}
        </p>
      </div>
    </div>
  )

  if (docked) {
    const statusLabel = status === 'running' ? null : t(STATUS_LABEL_KEYS[status])
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden p-3">
        <div data-testid="settings-terminal-toolbar" className="flex min-w-0 shrink-0 items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center">{toolbarLeading}</div>
          <DockedIconButton
            label={t('settings.terminal.clear')}
            onClick={clearTerminal}
            disabled={!runtime.terminal}
          >
            <Eraser size={14} strokeWidth={2} aria-hidden="true" />
          </DockedIconButton>
          <DockedIconButton label={t('settings.terminal.restart')} onClick={() => void startTerminal()}>
            <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
          </DockedIconButton>
        </div>
        {(meta || statusLabel) && (
          <div data-testid="terminal-meta" className="mx-0.5 mt-2.5 flex min-w-0 shrink-0 items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
            {meta && <span className="min-w-0 truncate">{meta}</span>}
            {meta && statusLabel && <span aria-hidden="true">·</span>}
            {statusLabel && <span className="shrink-0">{statusLabel}</span>}
          </div>
        )}
        <div className="mt-1.5 flex min-h-0 flex-1 flex-col">
          {notices}
          {status === 'unavailable' ? unavailableNotice : (
            <div
              data-testid="settings-terminal-frame"
              onWheelCapture={handleTerminalWheelCapture}
              className="min-h-[120px] flex-1 overflow-hidden rounded-[8px] border border-[var(--color-terminal-border)] bg-[var(--color-terminal-bg)] transition-colors focus-within:border-[var(--color-brand)]"
            >
              <div
                ref={hostRef}
                data-testid={testId}
                className="settings-terminal-host h-full w-full overflow-hidden px-2 pb-2 pt-1.5"
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden ${
      workspace
        ? 'min-h-0 bg-[var(--color-surface)] px-5 py-4'
        : 'min-h-[min(720px,calc(100vh-8rem))]'
    }`}>
      <div
        data-testid="settings-terminal-toolbar"
        className="mb-2 flex min-h-9 min-w-0 flex-wrap items-center gap-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-terminal-danger)]" aria-hidden="true" />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-terminal-warning)]" aria-hidden="true" />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-terminal-accent)]" aria-hidden="true" />
          <h2 className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">
            {t('settings.terminal.title')}
          </h2>
          <TerminalHelpHint />
          <StatusPill status={status} label={t(STATUS_LABEL_KEYS[status])} />
          {shellInfo && (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
              <span className="shrink-0 font-mono">{shellInfo.shell}</span>
              <span className="shrink-0 text-[var(--color-border)]">/</span>
              <span className="min-w-0 truncate font-mono">{shellInfo.cwd}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onNewTerminal && (
            <button
              type="button"
              onClick={onNewTerminal}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              {t('terminal.newTab')}
            </button>
          )}
          <button
            type="button"
            onClick={clearTerminal}
            disabled={!runtime.terminal}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">mop</span>
            {t('settings.terminal.clear')}
          </button>
          <button
            type="button"
            onClick={() => void startTerminal()}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-text-primary)] px-2.5 text-xs font-medium text-[var(--color-surface)] transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          >
            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            {t('settings.terminal.restart')}
          </button>
        </div>
      </div>

      {notices}

      {showPreferences && isWindows && terminalApi.isAvailable() && (
        <BashPathSettings isTauri />
      )}

      {status === 'unavailable' ? unavailableNotice : (
        <div
          data-testid="settings-terminal-frame"
          onWheelCapture={handleTerminalWheelCapture}
          className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-terminal-border)] bg-[var(--color-terminal-bg)] shadow-[var(--shadow-dropdown)]"
        >
          <div
            ref={hostRef}
            data-testid={testId}
            className="settings-terminal-host h-full w-full overflow-hidden px-2 pb-2 pt-1.5"
          />
        </div>
      )}
    </div>
  )
}

function DockedIconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  )
}

function TerminalHelpHint({ compact = false }: { compact?: boolean }) {
  const t = useTranslation()
  const tooltipId = useId()
  const [open, setOpen] = useState(false)

  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={t('settings.terminal.infoLabel')}
        aria-describedby={tooltipId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
        className={`${compact ? 'h-6 w-6' : 'h-7 w-7'} inline-flex items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]`}
      >
        <Info className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" strokeWidth={2.2} />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={`${open ? 'visible opacity-100' : 'invisible opacity-0'} absolute left-0 top-full z-30 mt-2 w-[min(340px,calc(100vw-3rem))] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-high)] px-3 py-2 text-left text-xs leading-5 text-[var(--color-text-secondary)] shadow-[var(--shadow-dropdown)] transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100`}
      >
        {t('settings.terminal.description')}
      </span>
    </span>
  )
}

function StatusPill({ status, label, compact = false }: { status: TerminalStatus; label: string; compact?: boolean }) {
  const color =
    status === 'running'
      ? 'bg-[var(--color-success)]'
      : status === 'error'
        ? 'bg-[var(--color-error)]'
        : status === 'starting'
          ? 'bg-[var(--color-warning)]'
          : 'bg-[var(--color-text-tertiary)]'

  return (
    <span className={`inline-flex ${compact ? 'h-5 px-2 text-[10px]' : 'h-6 px-2.5 text-[11px]'} shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] font-medium text-[var(--color-text-secondary)]`}>
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}

function BashPathSettings({ isTauri }: { isTauri: boolean }) {
  const t = useTranslation()
  const [bashPath, setBashPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    if (!isTauri) return
    void terminalApi.getBashPath().then((path) => setBashPath(path)).catch(() => {})
  }, [isTauri])

  const handleSave = async () => {
    const trimmed = bashPath?.trim() || null
    setSaving(true)
    setInvalid(false)
    setSaved(false)
    try {
      await terminalApi.setBashPath(trimmed)
      setBashPath(trimmed)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setInvalid(true)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setSaving(true)
    setSaved(false)
    setInvalid(false)
    try {
      await terminalApi.setBashPath(null)
      setBashPath(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
    } finally {
      setSaving(false)
    }
  }

  const handleBrowse = async () => {
    if (!isTauri) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        title: t('settings.terminal.bashPathLabel'),
        multiple: false,
        filters: [{
          name: 'Bash Executable',
          extensions: ['exe', '', 'bat', 'cmd', 'ps1'],
        }],
      })
      if (selected && typeof selected === 'string') {
        setBashPath(selected)
        setInvalid(false)
      }
    } catch {
    }
  }

  if (!isTauri) return null

  return (
    <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
      <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
        {t('settings.terminal.bashPathLabel')}
      </label>
      <p className="mb-2 text-xs text-[var(--color-text-tertiary)]">
        {t('settings.terminal.bashPathDescription')}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={bashPath || ''}
          onChange={(e) => { setBashPath(e.target.value); setInvalid(false); setSaved(false) }}
          placeholder={t('settings.terminal.bashPathLabel')}
          className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-mono text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
        />
        <button
          type="button"
          onClick={handleBrowse}
          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <span className="material-symbols-outlined text-[16px]">folder_open</span>
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] px-3 text-xs font-medium text-[var(--color-surface)] transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {saved ? t('settings.terminal.bashPathSaved') : t('settings.terminal.bashPathSave')}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={saving || bashPath === null}
          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          {t('settings.terminal.bashPathReset')}
        </button>
      </div>
      {invalid && (
        <p className="mt-1.5 text-xs text-[var(--color-error)]">
          {t('settings.terminal.bashPathInvalid')}
        </p>
      )}
    </div>
  )
}
