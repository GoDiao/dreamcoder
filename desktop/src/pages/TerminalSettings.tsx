import { BrushIcon, Eraser, Info, MonitorIcon, PlusIcon, RotateCcw } from 'lucide-react'
import { Button } from '../components/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/shared/ui/tooltip'
import { Tooltip as HintTooltip } from '../components/shared/Tooltip'
import { useCallback, useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { useUIStore } from '../stores/uiStore'
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

const TERMINAL_COLOR_VARS = {
  background: '--terminal',
  foreground: '--terminal-foreground',
  cursor: '--terminal-cursor',
  selectionBackground: '--terminal-selection',
  black: '--terminal-black',
  red: '--terminal-red',
  green: '--terminal-green',
  yellow: '--terminal-yellow',
  blue: '--terminal-blue',
  magenta: '--terminal-magenta',
  cyan: '--terminal-cyan',
  white: '--terminal-white',
  brightBlack: '--terminal-bright-black',
  brightRed: '--terminal-bright-red',
  brightGreen: '--terminal-bright-green',
  brightYellow: '--terminal-bright-yellow',
  brightBlue: '--terminal-bright-blue',
  brightMagenta: '--terminal-bright-magenta',
  brightCyan: '--terminal-bright-cyan',
  brightWhite: '--terminal-bright-white',
} as const

function readTerminalTheme(): Record<keyof typeof TERMINAL_COLOR_VARS, string> {
  const probe = document.createElement('div')
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const theme = {} as Record<keyof typeof TERMINAL_COLOR_VARS, string>
  for (const [key, cssVar] of Object.entries(TERMINAL_COLOR_VARS) as Array<[keyof typeof TERMINAL_COLOR_VARS, string]>) {
    probe.style.backgroundColor = `var(${cssVar})`
    theme[key] = getComputedStyle(probe).backgroundColor
  }
  probe.remove()
  return theme
}

const TERMINAL_FONT_SIZE = 12

async function loadTerminalFont(): Promise<string> {
  const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  await document.fonts.load(`${TERMINAL_FONT_SIZE}px ${fontFamily}`)
  return fontFamily
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
  const appTheme = useUIStore((state) => state.theme)
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

  useEffect(() => {
    if (runtime.terminal) runtime.terminal.options.theme = readTerminalTheme()
  }, [appTheme, runtime])

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

    runtime.starts += 1
    const start = runtime.starts
    const superseded = () => start !== runtime.starts
    updateTerminalRuntime(runtime, { error: null, warning: null, status: 'starting', shellInfo: null })

    runtime.connection?.close()
    runtime.connection = null
    runtime.dataDisposable?.dispose()
    runtime.dataDisposable = null

    runtime.terminal?.dispose()
    runtime.terminal = null
    runtime.fit = null
    host.innerHTML = ''

    const [{ Terminal }, { FitAddon }, fontFamily] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      loadTerminalFont(),
    ])
    if (superseded()) return

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: 1.25,
      scrollback: 4000,
      theme: readTerminalTheme(),
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
      if (superseded()) {
        connection.close()
        return
      }
      updateTerminalRuntime(runtime, {
        connection,
        shellInfo: { shell: connection.shell, cwd: connection.cwd },
        warning: connection.warning,
        status: 'running',
      })
      resizeSession()
    } catch (err) {
      if (superseded()) return
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
        <div className="px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {warning && (
        <div role="status" className="px-3 py-2 text-xs text-muted-foreground">
          <p>{t('settings.terminal.shellFallback', { shell: shellInfo?.shell ?? '' })}</p>
          <p className="mt-1">{warning}</p>
        </div>
      )}
    </>
  )

  const unavailableNotice = (
    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 text-center">
      <div>
        <MonitorIcon className="mx-auto shrink-0 mb-3 block text-subtle-foreground" aria-hidden="true" size={32} />
        <p className="text-sm font-medium text-foreground">
          {t('settings.terminal.unavailableTitle')}
        </p>
        <p className="mt-1 text-sm text-subtle-foreground">
          {t('settings.terminal.unavailableBody')}
        </p>
      </div>
    </div>
  )

  if (docked) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-terminal">
        <div data-testid="docked-terminal-actions" className="flex h-9 shrink-0 items-center gap-1 pr-2 pl-1">
          <span className="min-w-0 flex-1 truncate text-xs text-subtle-foreground">{meta}</span>
          <HintTooltip content={t('settings.terminal.clear')}>
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={t('settings.terminal.clear')}
              onClick={clearTerminal}
              disabled={!runtime.terminal}
            >
              <Eraser aria-hidden="true" />
            </Button>
          </HintTooltip>
          <HintTooltip content={t('settings.terminal.restart')}>
            <Button variant="ghost-muted" size="icon-xs" aria-label={t('settings.terminal.restart')} onClick={() => void startTerminal()}>
              <RotateCcw aria-hidden="true" />
            </Button>
          </HintTooltip>
        </div>
        {notices}
        {status === 'unavailable' ? unavailableNotice : (
          <div
            data-testid="settings-terminal-frame"
            onWheelCapture={handleTerminalWheelCapture}
            className="min-h-0 flex-1 overflow-hidden bg-terminal"
          >
            <div
              ref={hostRef}
              data-testid={testId}
              className="settings-terminal-host h-full w-full overflow-hidden p-1"
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`flex h-full flex-col overflow-hidden ${
      workspace
        ? 'min-h-0 bg-background px-5 py-4'
        : 'min-h-[min(720px,calc(100vh-8rem))]'
    }`}>
      <div
        data-testid="settings-terminal-toolbar"
        className="mb-2 flex min-h-9 min-w-0 flex-wrap items-center gap-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="shrink-0 text-sm font-semibold text-foreground">
            {t('settings.terminal.title')}
          </h2>
          <TerminalHelpHint />
          <StatusPill status={status} label={t(STATUS_LABEL_KEYS[status])} />
          {shellInfo && (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground">
              <span className="shrink-0 font-mono">{shellInfo.shell}</span>
              <span className="shrink-0 text-border">/</span>
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
          className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-terminal"
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
          variant="ghost-muted"
          size={compact ? 'icon-xs' : 'icon-sm'}
          aria-label={t('settings.terminal.infoLabel')}
          aria-expanded={open}
          onClick={(event) => { event.preventDefault(); setOpen((value) => !value) }}
        >
          <Info size={compact ? 14 : 16} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[min(340px,calc(100vw-3rem))] text-left">{t('settings.terminal.description')}</TooltipContent>
    </Tooltip>
  )
}

function StatusPill({ status, label, compact = false }: { status: TerminalStatus; label: string; compact?: boolean }) {
  const color =
    status === 'running'
      ? 'bg-success'
      : status === 'error'
        ? 'bg-destructive'
        : status === 'starting'
          ? 'bg-warning'
          : 'bg-subtle-foreground'

  return (
    <span className={`inline-flex ${compact ? 'h-5 px-2 text-3xs' : 'h-6 px-2.5 text-2xs'} shrink-0 items-center gap-1.5 rounded-full border border-border bg-card font-medium text-muted-foreground`}>
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}
