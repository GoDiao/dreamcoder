import { BrushIcon, Eraser, Info, MonitorIcon, PlusIcon, RotateCcw } from 'lucide-react'
import { Button } from '../components/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/shared/ui/tooltip'
import { Tooltip as HintTooltip } from '../components/shared/Tooltip'
import { useCallback, useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { useTranslation, type TranslationKey } from '../i18n'
import { TerminalDisconnectedError, terminalApi } from '../api/terminal'
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

  useEffect(() => {
    return subscribeTerminalRuntime(runtime, () => forceRuntimeUpdate((value) => value + 1))
  }, [runtime])

  useEffect(() => {
    if (shellInfo?.shell) onShellChange?.(shellInfo.shell)
  }, [onShellChange, shellInfo?.shell])

  const resizeSession = useCallback(() => {
    const terminal = runtime.terminal
    const fit = runtime.fit
    if (!terminal || !fit) return

    fit.fit()
    try {
      runtime.connection?.resize(terminal.cols, terminal.rows)
    } catch (err) {
      console.warn('[terminal] Failed to resize the terminal', err)
    }
  }, [runtime])

  const terminalErrorMessage = useCallback((err: unknown) => {
    if (err instanceof TerminalDisconnectedError) return t('settings.terminal.connectionClosed')
    return err instanceof Error ? err.message : String(err)
  }, [t])

  const startTerminal = useCallback(async () => {
    if (!terminalApi.isAvailable()) {
      updateTerminalRuntime(runtime, { status: 'unavailable' })
      return
    }

    const host = hostRef.current
    if (!host) return

    updateTerminalRuntime(runtime, { error: null, warning: null, status: 'starting', shellInfo: null })

    runtime.connection?.close()
    runtime.connection = null
    runtime.dataDisposable?.dispose()
    runtime.dataDisposable = null

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

    runtime.dataDisposable = terminal.onData((data) => {
      try {
        runtime.connection?.write(data)
      } catch (err) {
        updateTerminalRuntime(runtime, {
          error: terminalErrorMessage(err),
          status: 'error',
        })
      }
    })

    try {
      const connection = await terminalApi.open({
        cols: terminal.cols,
        rows: terminal.rows,
        ...(cwd ? { cwd } : {}),
        onOutput: (data) => terminal.write(data),
        onExit: (exit) => {
          const signal = exit.signal ? `, ${exit.signal}` : ''
          terminal.writeln(`\r\n[process exited: ${exit.code}${signal}]`)
          updateTerminalRuntime(runtime, { status: 'exited', connection: null })
        },
        onError: (message) => {
          updateTerminalRuntime(runtime, { error: message, status: 'error' })
        },
        onDisconnect: () => {
          updateTerminalRuntime(runtime, { error: t('settings.terminal.connectionClosed'), status: 'error' })
        },
      })
      updateTerminalRuntime(runtime, {
        connection,
        shellInfo: { shell: connection.shell, cwd: connection.cwd },
        warning: connection.warning,
        status: 'running',
      })
      resizeSession()
    } catch (err) {
      runtime.dataDisposable?.dispose()
      runtime.dataDisposable = null
      terminal.dispose()
      updateTerminalRuntime(runtime, {
        terminal: null,
        fit: null,
        error: terminalErrorMessage(err),
        status: 'error',
      })
    }
  }, [cwd, resizeSession, runtime, t, terminalErrorMessage])

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
        <div className="mb-3 rounded-md border border-[var(--color-error)]/20 bg-[var(--color-error)]/10 px-3 py-2 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {warning && (
        <div role="status" className="mb-3 rounded-md border border-[var(--color-terminal-warning)]/30 bg-[var(--color-terminal-warning)]/10 px-3 py-2 text-sm text-[var(--color-text-secondary)]">
          <p>{t('settings.terminal.shellFallback', { shell: shellInfo?.shell ?? '' })}</p>
          <p className="mt-1 text-xs">{warning}</p>
        </div>
      )}
    </>
  )

  const unavailableNotice = (
    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-8 text-center">
      <div>
        <MonitorIcon className="mx-auto shrink-0 mb-3 block text-[var(--color-text-tertiary)]" aria-hidden="true" size={32} />
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
          <HintTooltip content={t('settings.terminal.clear')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('settings.terminal.clear')}
              onClick={clearTerminal}
              disabled={!runtime.terminal}
            >
              <Eraser aria-hidden="true" />
            </Button>
          </HintTooltip>
          <HintTooltip content={t('settings.terminal.restart')}>
            <Button variant="ghost" size="icon-sm" aria-label={t('settings.terminal.restart')} onClick={() => void startTerminal()}>
              <RotateCcw aria-hidden="true" />
            </Button>
          </HintTooltip>
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
            <Button variant="outline" onClick={onNewTerminal}>
              <PlusIcon aria-hidden="true" />
              {t('terminal.newTab')}
            </Button>
          )}
          <Button variant="outline" onClick={clearTerminal} disabled={!runtime.terminal}>
            <BrushIcon aria-hidden="true" />
            {t('settings.terminal.clear')}
          </Button>
          <Button onClick={() => void startTerminal()}>
            <RotateCcw aria-hidden="true" />
            {t('settings.terminal.restart')}
          </Button>
        </div>
      </div>

      {notices}

      {status === 'unavailable' ? unavailableNotice : (
        <div
          data-testid="settings-terminal-frame"
          onWheelCapture={handleTerminalWheelCapture}
          className="min-h-0 flex-1 overflow-hidden rounded-sm border border-[var(--color-terminal-border)] bg-[var(--color-terminal-bg)] shadow-[var(--shadow-dropdown)]"
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

function TerminalHelpHint({ compact = false }: { compact?: boolean }) {
  const t = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? 'icon-xs' : 'icon-sm'}
          aria-label={t('settings.terminal.infoLabel')}
          aria-expanded={open}
          onClick={(event) => { event.preventDefault(); setOpen((value) => !value) }}
          className="rounded-full text-ui-muted-foreground"
        >
          <Info size={compact ? 14 : 16} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[min(340px,calc(100vw-3rem))] text-left leading-5">{t('settings.terminal.description')}</TooltipContent>
    </Tooltip>
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
