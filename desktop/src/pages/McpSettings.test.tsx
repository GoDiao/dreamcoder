import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpSettings } from './McpSettings'
import { useMcpStore } from '../stores/mcpStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useSessionStore } from '../stores/sessionStore'
import type { McpServerRecord } from '../types/mcp'

const api = vi.hoisted(() => ({
  list: vi.fn(), projectPaths: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  toggle: vi.fn(), reconnect: vi.fn(), status: vi.fn(),
}))
vi.mock('../api/mcp', () => ({ mcpApi: api }))
vi.mock('../api/sessions', () => ({ sessionsApi: { getRecentProjects: vi.fn().mockResolvedValue({ projects: [] }) } }))

const server: McpServerRecord = {
  name: 'filesystem', scope: 'user', transport: 'stdio', enabled: true, status: 'connected', statusLabel: 'Connected',
  configLocation: '/fake/config.json', summary: 'Fake configured filesystem',
  canEdit: true, canRemove: true, canReconnect: true, canToggle: true,
  config: { type: 'stdio', command: 'fake-filesystem', args: [], env: {} },
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsStore.setState({ locale: 'en' })
  useSessionStore.setState({ sessions: [], activeSessionId: null })
  useMcpStore.setState({ servers: [], selectedServer: null, isLoading: false, error: null })
  api.list.mockResolvedValue({ servers: [server] })
  api.projectPaths.mockResolvedValue({ projectPaths: [] })
})
afterEach(cleanup)

function expectNoWrites() {
  for (const mutation of [api.create, api.update, api.remove, api.toggle, api.reconnect]) expect(mutation).not.toHaveBeenCalled()
}

describe('MCP Installed / Browse navigation', () => {
  it('defaults to installed and keeps browsing read-only across searches and repeated tab switches', async () => {
    render(<McpSettings />)
    expect(screen.getByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByRole('button', { name: 'Open filesystem' })
    expect(screen.getByRole('button', { name: /Add server/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }))
    expect(screen.queryByRole('button', { name: /Add server/ })).not.toBeInTheDocument()
    const files = await screen.findByRole('article', { name: 'Filesystem' })
    expect(within(files).getByText('Name already installed')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'brave' } })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('article', { name: 'Brave Search' })).toHaveTextContent('BRAVE_API_KEY')
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    expect(screen.getByRole('button', { name: 'Open filesystem' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }))
    expect(screen.getByRole('searchbox')).toHaveValue('brave')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(useMcpStore.getState().servers).toEqual([{ ...server, projectPath: undefined }])
    expectNoWrites()
  })

  it('supports arrow, Home and End navigation with one tab stop and labelled panels', async () => {
    render(<McpSettings />)
    await screen.findByRole('button', { name: 'Open filesystem' })
    const installed = screen.getByRole('tab', { name: 'Installed' })
    const browse = screen.getByRole('tab', { name: 'Browse' })
    installed.focus()
    fireEvent.keyDown(installed, { key: 'ArrowRight' })
    expect(browse).toHaveFocus()
    expect(browse).toHaveAttribute('tabindex', '0')
    expect(installed).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel', { name: 'Browse' })).toHaveAttribute('id', browse.getAttribute('aria-controls'))
    fireEvent.keyDown(browse, { key: 'ArrowRight' })
    expect(installed).toHaveFocus()
    fireEvent.keyDown(installed, { key: 'End' })
    expect(browse).toHaveFocus()
    fireEvent.keyDown(browse, { key: 'Home' })
    expect(installed).toHaveFocus()
    await act(async () => {})
    expectNoWrites()
  })

  it('allows Browse during installed loading and after a server API failure', async () => {
    let reject!: (error: Error) => void
    api.list.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    render(<McpSettings />)
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }))
    await screen.findByRole('article', { name: 'Filesystem' })
    expect(screen.getByText('Checking installed server names…')).toBeInTheDocument()
    await act(async () => { reject(new Error('Fake backend unavailable')) })
    expect(screen.getByText(/Installed server names are unavailable/)).toBeInTheDocument()
    expect(screen.queryByText('Name already installed')).not.toBeInTheDocument()
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    expect(screen.getByText('Fake backend unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('button', { name: 'Open filesystem' })
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }))
    expect(screen.getByText('Name already installed')).toBeInTheDocument()
    expectNoWrites()
  })

  it('preserves installed editing and deletion confirmation after browsing', async () => {
    api.remove.mockResolvedValue({ ok: true })
    render(<McpSettings />)
    await screen.findByRole('button', { name: 'Open filesystem' })
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }))
    await screen.findByRole('article', { name: 'Filesystem' })
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open filesystem' }))
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('filesystem')
    fireEvent.click(screen.getByRole('button', { name: /Uninstall/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expectNoWrites()
    fireEvent.click(screen.getByRole('button', { name: /Uninstall/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('filesystem', 'user', undefined))
    expect(await screen.findByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Browse' }))
    await screen.findByRole('article', { name: 'Filesystem' })
    expect(screen.queryByText('Name already installed')).not.toBeInTheDocument()
  })
})
