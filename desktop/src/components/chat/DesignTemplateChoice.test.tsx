import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  templates: vi.fn(),
  preview: vi.fn(),
  isDesktopRuntime: vi.fn(),
  toastError: vi.fn(),
  submitBrowserInput: vi.fn(),
}))

vi.mock('../../api/websocket', () => ({
  wsManager: { connect: vi.fn(), disconnect: vi.fn(), onMessage: vi.fn(() => () => {}), clearHandlers: vi.fn(), send: mocks.send },
}))
vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getTranscript: vi.fn(async () => ({ items: [], agentNotifications: {}, lastTodos: null, hasMessagesAfterTaskCompletion: false })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))
vi.mock('../../api/design', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/design')>()),
  designApi: { templates: mocks.templates, preview: mocks.preview },
}))
vi.mock('../../lib/desktopRuntime', () => ({ isDesktopRuntime: mocks.isDesktopRuntime }))
vi.mock('../../lib/browserGuests', () => ({ closeBrowser: vi.fn(), submitBrowserInput: mocks.submitBrowserInput }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { useChatStore } from '../../stores/chatStore'
import { useDesignTemplateStore } from '../../stores/designTemplateStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import type { DesignTemplate } from '../../types/design'
import { DesignTemplateChoice } from './DesignTemplateChoice'

const SESSION = 'session-1'
const input = {
  candidates: [
    { id: 'saas', reason: 'You want a landing page' },
    { id: 'app-a', reason: 'You need an app screen' },
  ],
  title: 'Launch',
}

const template = (id: string, category: DesignTemplate['category']): DesignTemplate => ({
  id,
  category,
  platform: null,
  scenario: null,
  entry: 'index.html',
  acceptsDesignSystem: true,
  title: { en: `Title ${id}`, zh: `标题 ${id}` },
  description: { en: '', zh: '' },
  tags: [],
})

function setPending(toolUseId: string | null) {
  useChatStore.setState({
    sessions: {
      [SESSION]: {
        ...useChatStore.getState().getSession(SESSION),
        pendingPermission: toolUseId ? { requestId: 'perm-1', toolName: 'ChooseDesignTemplate', toolUseId, input } : null,
      },
    },
  })
}

describe('DesignTemplateChoice', () => {
  beforeEach(() => {
    mocks.isDesktopRuntime.mockReturnValue(true)
    mocks.templates.mockResolvedValue({ version: 1, templates: [template('saas', 'web'), template('app-a', 'prototype')] })
    mocks.preview.mockResolvedValue({ rootDir: '/app/design-templates/saas', filePath: '/app/design-templates/saas/index.html' })
    mocks.submitBrowserInput.mockResolvedValue(undefined)
    useSettingsStore.setState({ locale: 'en' })
    setPending('tool-1')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    useChatStore.setState(useChatStore.getInitialState(), true)
    useDesignTemplateStore.setState(useDesignTemplateStore.getInitialState(), true)
    useWorkspacePanelStore.setState(useWorkspacePanelStore.getInitialState(), true)
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  })

  it('shows a card per candidate with its title, type and reason, and a last card to start from scratch', async () => {
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} />)

    const cards = screen.getAllByTestId('design-choice-card')
    expect(cards).toHaveLength(2)
    expect(await within(cards[0]!).findByText('Title saas')).toBeInTheDocument()
    expect(within(cards[0]!).getByText('Web')).toBeInTheDocument()
    expect(within(cards[0]!).getByText('You want a landing page')).toBeInTheDocument()
    expect(within(cards[1]!).getByText('Prototype')).toBeInTheDocument()
    expect(screen.getByTestId('design-choice-scratch')).toHaveTextContent('No template, start from scratch')
  })

  it('answers the waiting request with the chosen template through updatedInput', () => {
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} />)

    fireEvent.click(within(screen.getAllByTestId('design-choice-card')[1]!).getByRole('button', { name: 'Use this template' }))

    expect(mocks.send).toHaveBeenCalledWith(SESSION, {
      type: 'permission_response',
      requestId: 'perm-1',
      allowed: true,
      updatedInput: { ...input, choice: 'app-a' },
    })
  })

  it('answers with the scratch choice', () => {
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} />)

    fireEvent.click(screen.getByTestId('design-choice-scratch'))

    expect(mocks.send).toHaveBeenCalledWith(SESSION, expect.objectContaining({ allowed: true, updatedInput: { ...input, choice: 'scratch' } }))
  })

  it('cannot be answered when its request is not the one waiting', () => {
    setPending('another-tool')
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} />)

    expect(screen.getAllByRole('button', { name: 'Use this template' })[0]).toBeDisabled()
    expect(screen.getByTestId('design-choice-scratch')).toBeDisabled()
  })

  it('shows the chosen template once the result is in, and cannot be answered again', async () => {
    setPending(null)
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} result={{ choice: 'saas' }} />)

    expect(await screen.findByText('Chosen: Title saas')).toBeInTheDocument()
    expect(screen.getAllByTestId('design-choice-card')[0]).toHaveAttribute('data-picked', 'true')
    expect(screen.getAllByTestId('design-choice-card')[1]).toHaveAttribute('data-picked', 'false')
    expect(screen.getByRole('button', { name: 'Use this template' })).toBeDisabled()
  })

  it('shows that the user started from scratch', () => {
    setPending(null)
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} result={{ choice: 'scratch' }} />)

    expect(screen.getByText('Started from scratch')).toBeInTheDocument()
    expect(screen.getByTestId('design-choice-scratch')).toHaveAttribute('data-picked', 'true')
  })

  it('says no template was chosen when the request ended without an answer', () => {
    setPending(null)
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} result="User declined to answer questions" />)

    expect(screen.getByText('No template chosen')).toBeInTheDocument()
  })

  it('opens the template preview in the side panel of the session', async () => {
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} />)

    fireEvent.click(within(screen.getAllByTestId('design-choice-card')[0]!).getByRole('button', { name: 'Preview' }))

    await vi.waitFor(() => expect(mocks.submitBrowserInput).toHaveBeenCalledWith(
      SESSION,
      expect.any(String),
      '/app/design-templates/saas/index.html',
      '/app/design-templates/saas',
    ))
    expect(useWorkspacePanelStore.getState().panelBySession[SESSION]?.tabs[0]).toMatchObject({ kind: 'browser', template: { id: 'saas' } })
  })

  it('tells the user when the preview could not be opened', async () => {
    mocks.preview.mockRejectedValue(new Error('Template not found: saas'))
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} />)

    fireEvent.click(within(screen.getAllByTestId('design-choice-card')[0]!).getByRole('button', { name: 'Preview' }))

    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Template not found: saas'))
  })

  it('offers no preview outside the desktop app', () => {
    mocks.isDesktopRuntime.mockReturnValue(false)
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} />)

    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument()
  })

  it('names a candidate by its id while the catalog has not loaded', () => {
    mocks.templates.mockReturnValue(new Promise(() => {}))
    render(<DesignTemplateChoice sessionId={SESSION} toolUseId="tool-1" input={input} />)

    expect(screen.getByText('saas')).toBeInTheDocument()
  })
})
