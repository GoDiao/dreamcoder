import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { setBaseUrl, getDefaultBaseUrl } from '../../api/client'
import { UI_PAGE_MAX_HEIGHT, UI_PAGE_MIN_HEIGHT, UI_PAGE_READY_TIMEOUT_MS } from '../../lib/uiPageBridge'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { UiPageFrame } from './UiPageFrame'

const pageId = 'a1b2c3d4e5f6a1b2c3d4e5f6'
const settings = useSettingsStore.getState()
const ui = useUIStore.getState()

const rpc = (message: Record<string, unknown>) => ({ jsonrpc: '2.0', ...message })

function frameOf() {
  const frame = screen.getByTitle(/Interactive page/) as HTMLIFrameElement
  const post = vi.fn()
  Object.defineProperty(frame.contentWindow, 'postMessage', { value: post, configurable: true })
  return { frame, post }
}

function fromPage(frame: HTMLIFrameElement, data: unknown, source: Window | null = frame.contentWindow) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source }))
  })
}

function renderFrame() {
  render(<UiPageFrame sessionId="s1" pageId={pageId} revision={1} title="Chart" />)
  return frameOf()
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  setBaseUrl('http://127.0.0.1:4567')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useSettingsStore.setState(settings, true)
  useUIStore.setState(ui, true)
  setBaseUrl(getDefaultBaseUrl())
})

describe('page frame', () => {
  it('loads the page from the sidecar in a frame that has an opaque origin', () => {
    const { frame } = renderFrame()

    expect(frame.getAttribute('src')).toBe(`http://127.0.0.1:4567/ui-pages/s1/${pageId}/1`)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('sandbox')?.split(/\s+/)).toEqual(['allow-scripts'])
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame.hasAttribute('srcdoc')).toBe(false)
  })

  it('answers the handshake with the theme and stays hidden until the page is ready', () => {
    const { frame, post } = renderFrame()
    expect(frame).toHaveClass('opacity-0')

    fromPage(frame, rpc({ id: 1, method: 'ui/initialize', params: {} }))

    expect(post).toHaveBeenCalledTimes(1)
    const [reply, target] = post.mock.calls[0]!
    expect(target).toBe('*')
    expect(reply).toMatchObject({ jsonrpc: '2.0', id: 1, result: { hostContext: { theme: 'light' } } })
    expect(frame).toHaveClass('opacity-0')

    fromPage(frame, rpc({ method: 'ui/notifications/initialized' }))
    expect(frame).not.toHaveClass('opacity-0')
  })

  it('follows the content height within the limits', () => {
    const { frame } = renderFrame()

    fromPage(frame, rpc({ method: 'ui/notifications/size-changed', params: { height: 321.2 } }))
    expect(frame).toHaveStyle({ height: '322px' })
    fromPage(frame, rpc({ method: 'ui/notifications/size-changed', params: { height: 100000 } }))
    expect(frame).toHaveStyle({ height: `${UI_PAGE_MAX_HEIGHT}px` })
    fromPage(frame, rpc({ method: 'ui/notifications/size-changed', params: { height: 1 } }))
    expect(frame).toHaveStyle({ height: `${UI_PAGE_MIN_HEIGHT}px` })
  })

  it('ignores messages that do not come from its own frame', () => {
    const { frame, post } = renderFrame()
    const other = document.createElement('iframe')
    document.body.append(other)

    fromPage(frame, rpc({ id: 1, method: 'ui/initialize' }), other.contentWindow)
    fromPage(frame, rpc({ method: 'ui/notifications/initialized' }), window)
    fromPage(frame, rpc({ method: 'ui/notifications/size-changed', params: { height: 500 } }), null)
    fromPage(frame, rpc({ method: 'notifications/message', params: { level: 'error', data: 'spoofed' } }), other.contentWindow)

    expect(post).not.toHaveBeenCalled()
    expect(frame).toHaveClass('opacity-0')
    expect(frame).not.toHaveStyle({ height: '500px' })
    expect(screen.queryByText(/spoofed/)).toBeNull()
    other.remove()
  })

  it('ignores messages from its own frame that are not ready, resize or error', () => {
    const { frame, post } = renderFrame()

    fromPage(frame, rpc({ id: 5, method: 'tools/call', params: { name: 'Bash', arguments: { command: 'id' } } }))
    fromPage(frame, rpc({ id: 6, method: 'ui/message', params: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }))
    fromPage(frame, rpc({ method: 'ui/open-link', params: { url: 'https://example.com' } }))
    fromPage(frame, { type: 'dreamcoder:anything' })

    expect(post).not.toHaveBeenCalled()
    expect(frame).toHaveClass('opacity-0')
  })

  it('shows an error the page reports', () => {
    const { frame } = renderFrame()

    fromPage(frame, rpc({ method: 'notifications/message', params: { level: 'error', data: 'x is not defined' } }))

    expect(screen.getByText('The page reported an error: x is not defined')).toBeInTheDocument()
  })

  it('pushes the new theme to an open page when the theme changes', () => {
    const { frame, post } = renderFrame()
    fromPage(frame, rpc({ id: 1, method: 'ui/initialize' }))
    fromPage(frame, rpc({ method: 'ui/notifications/initialized' }))
    post.mockClear()

    act(() => {
      useUIStore.setState({ theme: 'aurora' })
    })

    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]![0]).toMatchObject({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { theme: 'dark' },
    })
  })

  it('does not send a theme update before the page is ready', () => {
    const { post } = renderFrame()

    act(() => {
      useUIStore.setState({ theme: 'aurora' })
    })

    expect(post).not.toHaveBeenCalled()
  })

  it('tells the user when the page never becomes ready', () => {
    vi.useFakeTimers()
    renderFrame()

    act(() => {
      vi.advanceTimersByTime(UI_PAGE_READY_TIMEOUT_MS + 1)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('The page could not be loaded.')
  })
})
