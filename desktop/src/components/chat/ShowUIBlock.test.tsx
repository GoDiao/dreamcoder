import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { ELECTRON_BRIDGE_KEY } from '../../lib/shell/electronBridge'
import { useChatStore } from '../../stores/chatStore'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ShowUIBlock } from './ShowUIBlock'
import { buildRenderModel } from './MessageList'

const viewport = vi.hoisted(() => ({ isMobile: false }))
vi.mock('../../hooks/useMobileViewport', () => ({ useMobileViewport: () => viewport.isMobile }))

const pageId = 'a1b2c3d4e5f6a1b2c3d4e5f6'
const settings = useSettingsStore.getState()
const chat = useChatStore.getState()

const result = (revision: number, title = 'Login page') => ({
  content: JSON.stringify({ pageId, revision, title }),
  isError: false,
})
const write = { title: 'Login page', blocks: [] }

const toolUse = (id: string, toolName: string, input: unknown = {}) =>
  ({ id: `u-${id}`, type: 'tool_use', toolName, toolUseId: id, input, timestamp: 1 })
const toolResult = (id: string, content: unknown, isError = false) =>
  ({ id: `r-${id}`, type: 'tool_result', toolUseId: id, content, isError, timestamp: 2 })
const thinking = (id: string) => ({ id, type: 'thinking', content: 'thinking', timestamp: 1 })

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
})

afterEach(() => {
  cleanup()
  viewport.isMobile = false
  delete (window as unknown as Record<string, unknown>)[ELECTRON_BRIDGE_KEY]
  useWorkspacePanelStore.setState(useWorkspacePanelStore.getInitialState(), true)
  localStorage.clear()
  useSettingsStore.setState(settings, true)
  useChatStore.setState(chat, true)
})

describe('ShowUI block', () => {
  it('shows the first revision in a card that starts open and collapses', () => {
    render(<ShowUIBlock sessionId="s1" input={write} result={result(1)} />)

    expect(screen.getByTestId('show-ui-card')).toHaveTextContent('Login page · rev 1')
    expect(document.querySelector('iframe')).toHaveAttribute('src', expect.stringContaining(`/ui-pages/s1/${pageId}/1`))

    fireEvent.click(screen.getByRole('button', { name: 'Hide this revision' }))
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('shows a later revision as a card that starts closed and expands in place', () => {
    render(<ShowUIBlock sessionId="s1" input={write} result={result(3)} />)

    const card = screen.getByRole('button', { name: 'Show this revision' })
    expect(card).toHaveTextContent('Login page · rev 3')
    expect(document.querySelector('iframe')).toBeNull()

    fireEvent.click(card)
    expect(document.querySelector('iframe')).toHaveAttribute('src', expect.stringContaining(`/ui-pages/s1/${pageId}/3`))
  })

  it('enlarges the page in a dialog', () => {
    render(<ShowUIBlock sessionId="s1" input={write} result={result(3)} />)

    fireEvent.click(screen.getByRole('button', { name: 'View larger' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Login page')
    expect(dialog.querySelector('iframe')).toHaveAttribute('src', expect.stringContaining(`/ui-pages/s1/${pageId}/3`))
  })

  it('opens the revision as a page tab in the side panel', () => {
    render(<ShowUIBlock sessionId="s1" input={write} result={result(2)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open in side panel' }))

    expect(useWorkspacePanelStore.getState().isPanelOpen('s1')).toBe(true)
    expect(useWorkspacePanelStore.getState().getActiveTab('s1')).toEqual({
      id: expect.any(String),
      kind: 'uiPage',
      pageId,
      revision: 2,
      title: 'Login page',
    })
  })

  it('hides the side panel action on a phone, where the H5 page has no side panel', () => {
    viewport.isMobile = true
    const { unmount } = render(<ShowUIBlock sessionId="s1" input={write} result={result(2)} />)
    expect(screen.queryByRole('button', { name: 'Open in side panel' })).toBeNull()
    unmount()

    Object.assign(window, { [ELECTRON_BRIDGE_KEY]: {} })
    render(<ShowUIBlock sessionId="s1" input={write} result={result(2)} />)
    expect(screen.getByRole('button', { name: 'Open in side panel' })).toBeInTheDocument()
  })

  it('marks the revision the session state holds as the latest', () => {
    const { rerender } = render(<ShowUIBlock sessionId="s1" input={write} result={result(2)} />)
    expect(screen.queryByText('Latest')).toBeNull()

    act(() => {
      useChatStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          s1: {
            ...state.getSession('s1'),
            mirror: { uiPages: [{ pageId, title: 'Login page', revision: 2 }] } as never,
          },
        },
      }))
    })
    rerender(<ShowUIBlock sessionId="s1" input={write} result={result(2)} />)
    expect(screen.getByText('Latest')).toBeInTheDocument()
  })

  it('shows nothing for a call that is running, failed, read a page or listed components', () => {
    const cases = [
      { input: write, result: null },
      { input: write, result: { content: 'Page is at revision 2, not 1.', isError: true } },
      { input: { pageId }, result: { content: JSON.stringify({ pageId, revision: 1, title: 'Login page', page: {} }), isError: false } },
      { input: { catalog: true }, result: { content: JSON.stringify({ components: [] }), isError: false } },
    ]
    for (const { input, result: callResult } of cases) {
      const { container, unmount } = render(<ShowUIBlock sessionId="s1" input={input} result={callResult} />)
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })

  it('groups ShowUI calls with other tools and thinking, and shows each saved page after its group', () => {
    const model = buildRenderModel([
      thinking('t1'),
      toolUse('a', 'ShowUI', { catalog: true }),
      toolResult('a', '{"components":[]}'),
      toolUse('b', 'ShowUI', { describe: ['chart'] }),
      toolResult('b', '{"components":[]}'),
      toolUse('c', 'ShowUI', write),
      toolResult('c', 'Read the data format of chart first', true),
      toolUse('d', 'ShowUI', write),
      toolResult('d', JSON.stringify({ pageId, revision: 1, title: 'Login page' })),
      thinking('t2'),
      toolUse('e', 'Read'),
      toolResult('e', 'file'),
    ] as never)

    expect(model.renderItems.map((item) => item.kind)).toEqual(['tool_group', 'message', 'tool_group'])
    const [first, page, second] = model.renderItems
    expect(first!.kind === 'tool_group' && first!.toolCalls.map((call) => call.toolUseId)).toEqual(['a', 'b', 'c', 'd'])
    expect(page!.kind === 'message' && page!.message.id).toBe('u-d')
    expect(second!.kind === 'tool_group' && second!.toolCalls.map((call) => call.toolUseId)).toEqual(['e'])
  })

  it('shows only the last revision of a page written several times in one turn, and again in a later turn', () => {
    const otherPage = 'b'.repeat(24)
    const saved = (id: string, revision: number, page = pageId) =>
      [toolUse(id, 'ShowUI', write), toolResult(id, JSON.stringify({ pageId: page, revision, title: 'Login page' }))]
    const model = buildRenderModel([
      { id: 'q1', type: 'user_text', content: 'draw', timestamp: 1 },
      ...saved('a', 1),
      ...saved('b', 2),
      ...saved('c', 1, otherPage),
      ...saved('d', 3),
      { id: 'q2', type: 'user_text', content: 'change it', timestamp: 3 },
      ...saved('e', 4),
    ] as never)

    const pages = model.renderItems.flatMap((item) => (item.kind === 'message' && item.message.type === 'tool_use' ? [item.message.toolUseId] : []))
    const calls = model.renderItems.flatMap((item) => (item.kind === 'tool_group' ? item.toolCalls.map((call) => call.toolUseId) : []))

    expect(pages).toEqual(['c', 'd', 'e'])
    expect(calls).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('keeps a page-writing call in its group without a page while it has no result', () => {
    const model = buildRenderModel([toolUse('a', 'Read'), toolUse('b', 'ShowUI', write)] as never)

    expect(model.renderItems.map((item) => item.kind)).toEqual(['tool_group'])
  })
})
