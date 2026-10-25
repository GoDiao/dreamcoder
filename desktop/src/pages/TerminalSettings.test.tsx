import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../stores/settingsStore'
import { destroyTerminalRuntime } from '../lib/terminalRuntime'

const terminalMocks = vi.hoisted(() => {
  const terminalInstance = {
    cols: 80,
    rows: 24,
    loadAddon: vi.fn(),
    open: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    clear: vi.fn(),
  }
  const fitInstance = {
    fit: vi.fn(),
  }
  return {
    available: false,
    terminalInstance,
    fitInstance,
    open: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    lastInput: null as null | {
      onOutput: (data: string) => void
      onExit: (exit: { code: number; signal: string | null }) => void
      onError: (message: string) => void
      onDisconnect: () => void
    },
    detectDefaultShell: vi.fn(),
  }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(() => terminalMocks.terminalInstance),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(() => terminalMocks.fitInstance),
}))

vi.mock('../api/terminal', () => ({
  TerminalDisconnectedError: class TerminalDisconnectedError extends Error {},
  terminalApi: {
    isAvailable: () => terminalMocks.available,
    open: terminalMocks.open,
    detectDefaultShell: terminalMocks.detectDefaultShell,
  },
}))

import { TerminalSettings } from './TerminalSettings'

describe('TerminalSettings', () => {
  afterEach(() => {
    cleanup()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    useSettingsStore.setState({
      desktopTerminal: {
        startupShell: 'system',
        customShellPath: '',
        bashPath: null,
      },
      setDesktopTerminal: vi.fn().mockResolvedValue(undefined),
    })
    terminalMocks.available = false
    terminalMocks.open.mockReset()
    terminalMocks.write.mockReset()
    terminalMocks.resize.mockReset()
    terminalMocks.close.mockReset()
    terminalMocks.lastInput = null
    terminalMocks.detectDefaultShell.mockImplementation(async () => ({ shell: '/bin/zsh', platform: /Win/i.test(navigator.platform) ? 'windows' : 'macos' }))
    terminalMocks.terminalInstance.loadAddon.mockClear()
    terminalMocks.terminalInstance.open.mockClear()
    terminalMocks.terminalInstance.dispose.mockClear()
    terminalMocks.terminalInstance.onData.mockClear()
    terminalMocks.terminalInstance.write.mockClear()
    terminalMocks.terminalInstance.writeln.mockClear()
    terminalMocks.terminalInstance.clear.mockClear()
    terminalMocks.fitInstance.fit.mockClear()
    terminalMocks.open.mockImplementation(async (input) => {
      terminalMocks.lastInput = input
      return {
        shell: '/bin/zsh',
        cwd: '/Users/test',
        warning: null,
        write: terminalMocks.write,
        resize: terminalMocks.resize,
        close: terminalMocks.close,
      }
    })
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
  })

  it('shows a desktop-runtime empty state outside the desktop app', () => {
    render(<TerminalSettings />)

    expect(screen.getByTestId('settings-terminal-toolbar')).toHaveTextContent('Terminal')
    expect(screen.getByText('Desktop runtime required')).toBeInTheDocument()
    expect(terminalMocks.open).not.toHaveBeenCalled()
  })

  it('starts a host terminal session in the desktop app', async () => {
    terminalMocks.available = true

    render(<TerminalSettings />)

    await waitFor(() => {
      expect(terminalMocks.open).toHaveBeenCalledWith(expect.objectContaining({ cols: 80, rows: 24 }))
      expect(terminalMocks.open.mock.calls[0]?.[0]).not.toHaveProperty('cwd')
    })
    expect(screen.getByText('/bin/zsh')).toBeInTheDocument()
    expect(screen.getByText('/Users/test')).toBeInTheDocument()
    expect(terminalMocks.terminalInstance.open).toHaveBeenCalled()
    expect(terminalMocks.fitInstance.fit).toHaveBeenCalled()
  })

  it('uses one compact toolbar instead of a nested terminal title bar', async () => {
    terminalMocks.available = true

    render(<TerminalSettings />)

    await waitFor(() => expect(terminalMocks.open).toHaveBeenCalled())
    expect(screen.getByTestId('settings-terminal-toolbar')).toHaveTextContent('/bin/zsh')
    expect(screen.getByTestId('settings-terminal-frame')).toBeInTheDocument()
    expect(screen.queryByText('Host shell')).not.toBeInTheDocument()
  })

  it('shows setup guidance from the terminal info button', () => {
    render(<TerminalSettings />)

    const button = screen.getByRole('button', { name: 'Terminal setup help' })
    const help = screen.getByRole('tooltip')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(help).toHaveTextContent('plugin, skill, and MCP setup')
    expect(help).toHaveTextContent('claude plugin install')
  })

  it('lets the settings page keep scrolling when the terminal is not focused', async () => {
    terminalMocks.available = true
    const container = document.createElement('div')
    container.style.overflowY = 'auto'
    let scrollTop = 0
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 300 })
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => { scrollTop = value },
    })
    const scrollBy = vi.fn(({ top }: ScrollToOptions) => {
      scrollTop += Number(top ?? 0)
    })
    Object.defineProperty(container, 'scrollBy', { configurable: true, value: scrollBy })
    document.body.appendChild(container)

    render(<TerminalSettings />, { container })
    await waitFor(() => expect(terminalMocks.open).toHaveBeenCalled())

    fireEvent.wheel(screen.getByTestId('settings-terminal-frame'), { deltaY: 48 })

    expect(scrollBy).toHaveBeenCalledWith({ top: 48, left: 0 })
    expect(scrollTop).toBe(48)
  })

  it('starts in the provided cwd when embedded in a project session', async () => {
    terminalMocks.available = true

    render(<TerminalSettings cwd="/tmp/current-project" />)

    await waitFor(() => {
      expect(terminalMocks.open).toHaveBeenCalledWith(expect.objectContaining({
        cols: 80,
        rows: 24,
        cwd: '/tmp/current-project',
      }))
    })
  })

  it('relays output, input and exit through the terminal connection', async () => {
    terminalMocks.available = true
    let sendInput: ((data: string) => void) | undefined
    terminalMocks.terminalInstance.onData.mockImplementation((handler: (data: string) => void) => {
      sendInput = handler
      return { dispose: vi.fn() }
    })

    render(<TerminalSettings />)
    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument())

    act(() => {
      terminalMocks.lastInput?.onOutput('hello\r\n')
      sendInput?.('ls\r')
    })
    expect(terminalMocks.terminalInstance.write).toHaveBeenCalledWith('hello\r\n')
    expect(terminalMocks.write).toHaveBeenCalledWith('ls\r')

    act(() => terminalMocks.lastInput?.onExit({ code: 2, signal: null }))
    expect(terminalMocks.terminalInstance.writeln).toHaveBeenCalledWith('\r\n[process exited: 2]')
    expect(screen.getByText('Exited')).toBeInTheDocument()
  })

  it('shows a translated message when the connection drops after the shell started', async () => {
    useSettingsStore.setState({ locale: 'zh' })
    terminalMocks.available = true
    render(<TerminalSettings />)
    await waitFor(() => expect(screen.getByText('运行中')).toBeInTheDocument())

    act(() => terminalMocks.lastInput?.onDisconnect())

    expect(await screen.findByText('终端连接已断开。')).toBeInTheDocument()
  })

  it('shows the start error when the shell cannot start', async () => {
    terminalMocks.available = true
    terminalMocks.open.mockRejectedValueOnce(new Error('terminal cwd does not exist: /missing'))

    render(<TerminalSettings cwd="/missing" />)

    expect(await screen.findByText('terminal cwd does not exist: /missing')).toBeInTheDocument()
    expect(terminalMocks.terminalInstance.dispose).toHaveBeenCalled()
  })

  it('can preserve and reattach a running terminal runtime across unmounts', async () => {
    terminalMocks.available = true

    const first = render(<TerminalSettings runtimeId="shared-runtime" preserveOnUnmount />)
    await waitFor(() => expect(terminalMocks.open).toHaveBeenCalledTimes(1))

    first.unmount()
    expect(terminalMocks.close).not.toHaveBeenCalled()

    render(<TerminalSettings runtimeId="shared-runtime" />)

    await waitFor(() => {
      expect(terminalMocks.terminalInstance.open).toHaveBeenCalledTimes(2)
    })
    expect(terminalMocks.open).toHaveBeenCalledTimes(1)

    destroyTerminalRuntime('shared-runtime')
  })

  it('shows fallback details while keeping the terminal running and clears them on restart', async () => {
    terminalMocks.available = true
    terminalMocks.open.mockResolvedValueOnce({
      shell: '/bin/zsh',
      cwd: '/Users/test',
      warning: 'terminal shell fish is not installed or executable',
      write: terminalMocks.write,
      resize: terminalMocks.resize,
      close: terminalMocks.close,
    })
    render(<TerminalSettings />)
    expect(await screen.findByRole('status')).toHaveTextContent('Your preferred shell is unavailable. Using /bin/zsh for this session.')
    expect(screen.getByRole('status')).toHaveTextContent('fish is not installed')
    expect(screen.getByText('Running')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Restart$/ }))
    await waitFor(() => expect(terminalMocks.open).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps a running terminal when settings change and closes it before a restart', async () => {
    terminalMocks.available = true
    render(<TerminalSettings />)
    await waitFor(() => expect(terminalMocks.open).toHaveBeenCalledTimes(1))
    const settings = { startupShell: 'custom' as const, customShellPath: '/opt/shell', bashPath: '/opt/bash' }

    await act(async () => { useSettingsStore.setState({ desktopTerminal: settings }) })
    expect(terminalMocks.open).toHaveBeenCalledTimes(1)
    expect(terminalMocks.close).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Restart$/ }))
    await waitFor(() => expect(terminalMocks.open).toHaveBeenCalledTimes(2))
    expect(terminalMocks.close).toHaveBeenCalledTimes(1)
  })

  it('resizes the connection when the terminal is fitted', async () => {
    terminalMocks.available = true
    render(<TerminalSettings />)
    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument())
    expect(terminalMocks.resize).toHaveBeenCalledWith(80, 24)
  })

  it('renders the docked panel layout with icon actions, leading tabs and a meta line', async () => {
    terminalMocks.available = true
    const onShellChange = vi.fn()

    render(
      <TerminalSettings
        docked
        runtimeId="docked-runtime"
        toolbarLeading={<span>tabs-slot</span>}
        meta="dreamcoder · main"
        onShellChange={onShellChange}
      />,
    )

    await waitFor(() => expect(terminalMocks.open).toHaveBeenCalled())
    expect(screen.getByText('tabs-slot')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-meta')).toHaveTextContent('dreamcoder · main')
    expect(screen.queryByText('Terminal')).not.toBeInTheDocument()
    await waitFor(() => expect(onShellChange).toHaveBeenCalledWith('/bin/zsh'))

    const clear = screen.getByRole('button', { name: 'Clear' })
    expect(clear).toHaveAttribute('title', 'Clear')
    fireEvent.click(clear)
    expect(terminalMocks.terminalInstance.clear).toHaveBeenCalled()

    const restart = screen.getByRole('button', { name: 'Restart' })
    expect(restart).toHaveAttribute('title', 'Restart')
    await act(async () => {
      fireEvent.click(restart)
    })
    await waitFor(() => expect(terminalMocks.open).toHaveBeenCalledTimes(2))
    destroyTerminalRuntime('docked-runtime')
  })
})
