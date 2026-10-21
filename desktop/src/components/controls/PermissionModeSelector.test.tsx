import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import '@testing-library/jest-dom'

const viewportMocks = vi.hoisted(() => ({
  isMobile: false,
}))

vi.mock('../../hooks/useMobileViewport', () => ({
  useMobileViewport: () => viewportMocks.isMobile,
}))

vi.mock('../../lib/desktopRuntime', () => ({
  isTauriRuntime: () => false,
}))

const computerUseMocks = vi.hoisted(() => ({
  getConfig: vi.fn(async () => ({ enabled: false, driverPath: null })),
}))

vi.mock('../../api/computerUse', () => ({
  computerUseApi: computerUseMocks,
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => ({
    'permMode.askPermDesc': 'Ask before changing files or running commands',
    'permMode.autoAcceptDesc': 'Automatically accept edit operations',
    'permMode.planModeDesc': 'Plan before executing',
    'permMode.bypassDesc': 'Run without permission prompts',
    'permMode.executionPermissions': 'Execution Permissions',
    'permMode.label.default': 'Manual',
    'permMode.defaultTag': 'default',
    'permMode.label.acceptEdits': 'Accept edits',
    'permMode.label.plan': 'Plan',
    'permMode.label.bypassPermissions': 'Bypass permissions',
    'permMode.label.dontAsk': "Don't ask",
    'permMode.enableBypassTitle': 'Enable bypass mode',
    'permMode.enableBypassSubtitle': 'This is risky',
    'permMode.enableBypassBody': 'Bypass permissions for this workspace.',
    'permMode.permReadWrite': 'Read and write files',
    'permMode.permShell': 'Run shell commands',
    'permMode.permPackages': 'Install packages',
    'permMode.enableBypassBtn': 'Enable bypass',
    'permMode.computerUseBypassWarning': 'Computer Use actions will no longer ask for confirmation.',
    'common.cancel': 'Cancel',
    'tabs.close': 'Close',
  }[key] ?? key),
}))

import { PermissionModeSelector } from './PermissionModeSelector'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'

function renderSelector(props: Partial<ComponentProps<typeof PermissionModeSelector>> = {}) {
  const onChange = props.onChange ?? vi.fn()
  render(<PermissionModeSelector value="default" {...props} onChange={onChange} />)
  return { onChange }
}

describe('PermissionModeSelector', () => {
  beforeEach(() => {
    viewportMocks.isMobile = false
    computerUseMocks.getConfig.mockResolvedValue({ enabled: false, driverPath: null })
    useSettingsStore.setState({ permissionMode: 'default' })
    useSessionStore.setState({ sessions: [], activeSessionId: null })
    useTabStore.setState({ activeTabId: null, tabs: [] })
  })

  it('labels the compact mobile trigger and opens a phone-sized menu sheet', () => {
    viewportMocks.isMobile = true

    renderSelector({ compact: true, workDir: '/repo' })

    const trigger = screen.getByRole('button', { name: 'Manual' })
    expect(trigger).toHaveClass('h-11', 'w-11')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', 'permission-mode-menu')
    expect(screen.getByRole('dialog', { name: 'Execution Permissions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /Accept edits/ })).toBeInTheDocument()
  })

  it('uses the active tab workspace when showing the bypass confirmation path', () => {
    useSessionStore.setState({
      activeSessionId: 'previous-session',
      sessions: [
        {
          id: 'previous-session',
          title: 'Previous',
          createdAt: '2026-05-24T00:00:00.000Z',
          modifiedAt: '2026-05-24T00:00:00.000Z',
          messageCount: 1,
          projectPath: 'C:\\Users\\LinTan',
          projectRoot: 'C:\\Users\\LinTan',
          workDir: 'C:\\Users\\LinTan',
          workDirExists: true,
        },
        {
          id: 'current-tab',
          title: 'Current',
          createdAt: '2026-05-24T00:00:00.000Z',
          modifiedAt: '2026-05-24T00:00:00.000Z',
          messageCount: 1,
          projectPath: 'C:\\Users\\LinTan\\MyScript\\test5',
          projectRoot: 'C:\\Users\\LinTan\\MyScript\\test5',
          workDir: 'C:\\Users\\LinTan\\MyScript\\test5',
          workDirExists: true,
        },
      ],
    })
    useTabStore.setState({
      activeTabId: 'current-tab',
      tabs: [{ sessionId: 'current-tab', title: 'Current', type: 'session', status: 'idle' }],
    })

    renderSelector({ compact: true })

    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bypass permissions/ }))

    expect(screen.getByText('C:\\Users\\LinTan\\MyScript\\test5')).toBeInTheDocument()
    expect(screen.queryByText('C:\\Users\\LinTan')).not.toBeInTheDocument()
  })

  it('lists the modes without a menu heading and marks the current one', () => {
    renderSelector({ value: 'plan' })

    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))

    expect(screen.queryByText('Execution Permissions')).not.toBeInTheDocument()
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Manual'),
      expect.stringContaining('Accept edits'),
      expect.stringContaining('Plan'),
      expect.stringContaining('Bypass permissions'),
    ])
    expect(screen.getByRole('menuitemradio', { name: /Plan/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the value it is given, not the default for new sessions', () => {
    useSettingsStore.setState({ permissionMode: 'acceptEdits' })

    renderSelector({ value: 'plan' })

    expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument()
  })

  it('marks the default for new sessions with a tag', () => {
    useSettingsStore.setState({ permissionMode: 'acceptEdits' })

    renderSelector({ value: 'plan' })
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))

    expect(screen.getByRole('menuitemradio', { name: /Accept edits/ })).toHaveTextContent('default')
    expect(screen.getByRole('menuitemradio', { name: /Plan/ })).not.toHaveTextContent('default')
  })

  it('reports a picked mode through onChange and leaves the default for new sessions alone', () => {
    const setDefault = vi.fn(async () => {})
    useSettingsStore.setState({ setPermissionMode: setDefault })

    const { onChange } = renderSelector()
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Accept edits/ }))

    expect(onChange).toHaveBeenCalledWith('acceptEdits')
    expect(setDefault).not.toHaveBeenCalled()
  })

  it('asks before switching to Bypass', () => {
    const { onChange } = renderSelector()
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bypass permissions/ }))

    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Enable bypass' }))
    expect(onChange).toHaveBeenCalledWith('bypassPermissions')
  })

  it('shows the dontAsk mode by its English name', () => {
    renderSelector({ value: 'dontAsk' })

    expect(screen.getByRole('button', { name: "Don't ask" })).toHaveTextContent("Don't ask")
  })

  it('warns that Computer Use actions skip confirmation when bypass is enabled with Computer Use on', async () => {
    computerUseMocks.getConfig.mockResolvedValue({ enabled: true, driverPath: null })
    renderSelector({ workDir: '/repo' })
    fireEvent.click(screen.getByRole('button', { name: /Manual/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bypass permissions/ }))
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Computer Use actions will no longer ask for confirmation.',
    )
  })

  it('shows no Computer Use warning when Computer Use is off', async () => {
    renderSelector({ workDir: '/repo' })
    fireEvent.click(screen.getByRole('button', { name: /Manual/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bypass permissions/ }))
    await waitFor(() => expect(computerUseMocks.getConfig).toHaveBeenCalled())
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})
