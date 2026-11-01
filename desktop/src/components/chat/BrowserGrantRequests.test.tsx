import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const replyBrowserGrant = vi.hoisted(() => vi.fn())

vi.mock('../../lib/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/shell')>()),
  replyBrowserGrant,
}))

import { BrowserGrantRequests } from './BrowserGrantRequests'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ELECTRON_BRIDGE_KEY } from '../../lib/shell/electronBridge'
import type { PendingBrowserGrant, SessionState } from '../../types/chat'

const SESSION_ID = 'session-1'

function grant(overrides: Partial<PendingBrowserGrant> = {}): PendingBrowserGrant {
  return {
    requestId: 'grant-1',
    origin: 'https://example.com',
    action: 'Click element [3]',
    requestedAt: 1,
    allowOnce: true,
    allowSession: true,
    ...overrides,
  }
}

function setGrants(grants: PendingBrowserGrant[], sessionId = SESSION_ID) {
  const mirror: SessionState = {
    id: sessionId,
    version: 1,
    permission: { desired: 'default', effective: 'default' },
    runtime: { desired: null, effective: null },
    title: { text: null, source: null },
    workspace: { workDir: '/repo', projectRoot: '/repo', workDirExists: true },
    process: { phase: 'running', generation: 1 },
    turn: { phase: 'idle' },
    pendingPermissions: [],
    pendingBrowserGrants: grants,
    browserActivity: null,
    slashCommands: [],
    activeGoal: null,
    backgroundTasks: [],
    uiPages: [],
    team: null,
    clientCount: 1,
  }
  act(() => {
    useChatStore.setState({
      sessions: { [sessionId]: { ...useChatStore.getState().getSession(sessionId), mirror } },
    })
  })
}

function setDesktop(enabled: boolean) {
  const target = window as unknown as Record<string, unknown>
  if (enabled) target[ELECTRON_BRIDGE_KEY] = {}
  else delete target[ELECTRON_BRIDGE_KEY]
}

describe('BrowserGrantRequests', () => {
  beforeEach(() => {
    replyBrowserGrant.mockReset()
    replyBrowserGrant.mockResolvedValue(undefined)
    useSettingsStore.setState({ locale: 'en' })
    setDesktop(true)
  })

  afterEach(() => {
    cleanup()
    setDesktop(false)
    useChatStore.setState(useChatStore.getInitialState(), true)
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    vi.restoreAllMocks()
  })

  it('shows the origin and action of each pending grant as its own card', () => {
    setGrants([
      grant(),
      grant({ requestId: 'grant-2', origin: 'https://other.test', action: 'Press Enter' }),
    ])
    render(<BrowserGrantRequests sessionId={SESSION_ID} />)

    expect(screen.getAllByRole('group', { name: 'Allow the agent to operate this site?' })).toHaveLength(2)
    expect(screen.getAllByTestId('browser-grant-origin').map((node) => node.textContent)).toEqual([
      'https://example.com',
      'https://other.test',
    ])
    expect(screen.getByText('Click element [3]')).toBeInTheDocument()
    expect(screen.getByText('Press Enter')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Allow once' })).toHaveLength(2)
  })

  it.each([
    ['Deny', 'deny'],
    ['Allow once', 'once'],
    ['Trust for this session', 'session'],
  ] as const)('sends %s as the %s decision for that request', async (label, decision) => {
    setGrants([grant({ requestId: 'grant-2' })])
    render(<BrowserGrantRequests sessionId={SESSION_ID} />)

    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(replyBrowserGrant).toHaveBeenCalledTimes(1))
    expect(replyBrowserGrant).toHaveBeenCalledWith({ requestId: 'grant-2', decision })
  })

  it('removes the card only when the session state drops the grant', async () => {
    setGrants([grant()])
    render(<BrowserGrantRequests sessionId={SESSION_ID} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(replyBrowserGrant).toHaveBeenCalled())
    expect(screen.getByTestId('browser-grant-origin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()

    setGrants([])
    expect(screen.queryByTestId('browser-grant-origin')).not.toBeInTheDocument()
  })

  it('hides Allow once and labels the allow button as a session trust when Bypass mode asks', () => {
    setGrants([grant({ allowOnce: false })])
    render(<BrowserGrantRequests sessionId={SESSION_ID} />)

    expect(screen.queryByRole('button', { name: 'Allow once' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trust for this session' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow and trust for this session' })).toBeInTheDocument()
    expect(screen.getByText(/Bypass mode/)).toBeInTheDocument()
  })

  it('offers only Allow once and Deny, with a note, when the page embeds another site', async () => {
    setGrants([grant({ allowSession: false })])
    render(<BrowserGrantRequests sessionId={SESSION_ID} />)

    expect(screen.queryByRole('button', { name: 'Trust for this session' })).not.toBeInTheDocument()
    expect(screen.getByText('This page embeds this site. Access is allowed once only.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(replyBrowserGrant).toHaveBeenCalledWith({ requestId: 'grant-1', decision: 'once' }))
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
  })

  it('shows the session trust button and no once-only note when the session may be trusted', () => {
    setGrants([grant()])
    render(<BrowserGrantRequests sessionId={SESSION_ID} />)

    expect(screen.getByRole('button', { name: 'Trust for this session' })).toBeInTheDocument()
    expect(screen.queryByText(/allowed once only/)).not.toBeInTheDocument()
  })

  it('keeps the card, shows a localized error and allows another try when the reply fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    replyBrowserGrant.mockRejectedValueOnce(new Error('the sidecar is not connected'))
    setGrants([grant()])
    render(<BrowserGrantRequests sessionId={SESSION_ID} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send your answer. Try again.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('sidecar')
    expect(screen.getByTestId('browser-grant-origin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(replyBrowserGrant).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('localizes the card in Chinese', () => {
    useSettingsStore.setState({ locale: 'zh' })
    setGrants([grant()])
    render(<BrowserGrantRequests sessionId={SESSION_ID} />)

    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本次允许' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本会话信任' })).toBeInTheDocument()
  })

  it('renders nothing outside the desktop app', () => {
    setDesktop(false)
    setGrants([grant()])
    const { container } = render(<BrowserGrantRequests sessionId={SESSION_ID} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for another session or when nothing is pending', () => {
    setGrants([grant()], 'other-session')
    const { container } = render(<BrowserGrantRequests sessionId={SESSION_ID} />)

    expect(container).toBeEmptyDOMElement()
  })
})
