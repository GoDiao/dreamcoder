import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    'permMode.askPermissions': 'Default',
    'permMode.askPermDesc': 'Ask before changing files or running commands',
    'permMode.autoAccept': 'Accept edits',
    'permMode.autoAcceptDesc': 'Automatically accept edit operations',
    'permMode.planMode': 'Plan',
    'permMode.planModeDesc': 'Plan before executing',
    'permMode.bypass': 'Bypass permissions',
    'permMode.bypassDesc': 'Run without permission prompts',
    'permMode.executionPermissions': 'Execution Permissions',
    'permMode.label.default': 'Default',
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

    render(<PermissionModeSelector compact workDir="/repo" />)

    const trigger = screen.getByRole('button', { name: 'Default' })
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

    render(<PermissionModeSelector compact />)

    fireEvent.click(screen.getByRole('button', { name: 'Default' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bypass permissions/ }))

    expect(screen.getByText('C:\\Users\\LinTan\\MyScript\\test5')).toBeInTheDocument()
    expect(screen.queryByText('C:\\Users\\LinTan')).not.toBeInTheDocument()
  })

  it('lists the modes without a menu heading and marks the current one', () => {
    useSettingsStore.setState({ permissionMode: 'plan' })

    render(<PermissionModeSelector />)

    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))

    expect(screen.queryByText('Execution Permissions')).not.toBeInTheDocument()
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Default'),
      expect.stringContaining('Accept edits'),
      expect.stringContaining('Plan'),
      expect.stringContaining('Bypass permissions'),
    ])
    expect(screen.getByRole('menuitemradio', { name: /Plan/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the dontAsk mode by its English name', () => {
    useSettingsStore.setState({ permissionMode: 'dontAsk' })

    render(<PermissionModeSelector />)

    expect(screen.getByRole('button', { name: "Don't ask" })).toHaveTextContent("Don't ask")
  })

  it('warns that Computer Use actions skip confirmation when bypass is enabled with Computer Use on', async () => {
    computerUseMocks.getConfig.mockResolvedValue({ enabled: true, driverPath: null })
    render(<PermissionModeSelector workDir="/repo" />)
    fireEvent.click(screen.getByRole('button', { name: /Default/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bypass permissions/ }))
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Computer Use actions will no longer ask for confirmation.',
    )
  })

  it('shows no Computer Use warning when Computer Use is off', async () => {
    render(<PermissionModeSelector workDir="/repo" />)
    fireEvent.click(screen.getByRole('button', { name: /Default/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Bypass permissions/ }))
    await waitFor(() => expect(computerUseMocks.getConfig).toHaveBeenCalled())
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})
