import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ToolCallBlock } from './ToolCallBlock'
import { PermissionDialog } from './PermissionDialog'
import { extractToolResultImages } from './ToolResultImages'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { isCuaPermissionError } from '../../lib/cuaToolDisplay'

const PNG_DATA = 'iVBORw0KGgo='

describe('cua tool display in chat blocks', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({ activeTabId: 'active-tab', tabs: [{ sessionId: 'active-tab', title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({ sessions: {} })
  })

  it('shows a Computer Use title and summary instead of the raw MCP name', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="mcp__cua__click"
        input={{ pid: 42, x: 120, y: 220 }}
        result={{ content: [{ type: 'text', text: 'clicked' }], isError: false }}
      />,
    )

    expect(container.textContent).toContain('Computer Use · Click')
    expect(container.textContent).toContain('(120, 220)')
    expect(container.textContent).not.toContain('mcp__cua__')
    expect(container.textContent).not.toMatch(/\bMCP\b/)
  })

  it('uses Chinese titles when the locale is zh', () => {
    useSettingsStore.setState({ locale: 'zh' })
    const { container } = render(<ToolCallBlock toolName="mcp__cua__type_text" input={{ text: '你好' }} />)
    expect(container.textContent).toContain('Computer Use · 输入文本')
  })

  it('links to Computer Use settings when a cua tool fails on missing system permissions', () => {
    useUIStore.setState({ settingsOpen: false, settingsTab: 'providers' })
    render(
      <ToolCallBlock
        toolName="mcp__cua__get_window_state"
        input={{ pid: 42, window_id: 7 }}
        result={{ content: [{ type: 'text', text: 'Screen Recording is NOT granted for this process.' }], isError: true }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Go to Computer Use settings' }))
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsTab: 'computerUse' })
  })

  it('shows no settings link for other failures', () => {
    render(
      <ToolCallBlock
        toolName="mcp__cua__click"
        input={{ pid: 42, x: 1, y: 1 }}
        result={{ content: 'window_id_not_found', isError: true }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Go to Computer Use settings' })).toBeNull()
  })

  it('renders image blocks in tool results as thumbnails that open a larger view', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="mcp__cua__get_window_state"
        input={{ pid: 1, window_id: 2 }}
        result={{
          content: [
            { type: 'text', text: 'window snapshot' },
            { type: 'image', data: PNG_DATA, mimeType: 'image/png' },
          ],
          isError: false,
        }}
      />,
    )

    expect(container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Computer Use · Read window/ }))

    const thumb = container.querySelector('[data-testid="tool-result-images"] img') as HTMLImageElement | null
    expect(thumb).toBeTruthy()
    expect(thumb!.getAttribute('src')).toBe(`data:image/png;base64,${PNG_DATA}`)

    fireEvent.click(screen.getByRole('button', { name: 'Image 1' }))
    expect(document.body.querySelectorAll(`img[src="data:image/png;base64,${PNG_DATA}"]`).length).toBeGreaterThan(1)
  })

  it('makes image-only results expandable', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Read"
        input={{ file_path: '/tmp/shot.png' }}
        result={{ content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: PNG_DATA } }], isError: false }}
      />,
    )
    fireEvent.click(screen.getAllByRole('button')[0]!)
    expect(container.querySelector('[data-testid="tool-result-images"] img')?.getAttribute('src')).toBe(`data:image/jpeg;base64,${PNG_DATA}`)
  })

  it('shows a Computer Use permission title without the raw MCP name', async () => {
    let container!: HTMLElement
    await act(async () => {
      container = render(
        <PermissionDialog
          requestId="perm-cua"
          toolName="mcp__cua__launch_app"
          input={{ bundle_id: 'com.apple.Safari' }}
          description="Claude requested permissions to use mcp__cua__launch_app, but you haven't granted it yet."
        />,
      ).container
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Allow Computer Use to launch com.apple.Safari?')
    expect(container.textContent).not.toContain('mcp__cua__')
    expect(container.textContent).not.toMatch(/\bMCP\b/)
  })

  it('uses the generic Computer Use permission title for click', async () => {
    let container!: HTMLElement
    await act(async () => {
      container = render(<PermissionDialog requestId="perm-click" toolName="mcp__cua__click" input={{ pid: 3, element_token: 's0000abcd:1' }} />).container
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Allow Computer Use to click?')
    expect(container.textContent).toContain('UI element')
    expect(container.textContent).not.toContain('mcp__cua__')
  })
})

describe('extractToolResultImages', () => {
  it('accepts MCP and Anthropic image blocks and ignores the rest', () => {
    expect(extractToolResultImages([
      { type: 'image', data: 'AAA', mimeType: 'image/png' },
      { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'BBB' } },
      { type: 'image', data: 'CCC', mimeType: 'text/html' },
      { type: 'image', source: { type: 'url', url: 'https://x' } },
      { type: 'text', text: 'hi' },
      null,
    ])).toEqual([{ src: 'data:image/png;base64,AAA' }, { src: 'data:image/webp;base64,BBB' }])
    expect(extractToolResultImages({ content: [{ type: 'image', data: 'D', mimeType: 'image/png' }] })).toHaveLength(1)
    expect(extractToolResultImages('text')).toEqual([])
    expect(extractToolResultImages(undefined)).toEqual([])
  })
})

describe('isCuaPermissionError', () => {
  const err = (text: string) => ({ content: [{ type: 'text', text }], isError: true })

  it('recognizes cua-driver permission errors', () => {
    expect(isCuaPermissionError('mcp__cua__click', err('Accessibility is not granted'))).toBe(true)
    expect(isCuaPermissionError('mcp__cua__zoom', err('run `cua-driver permissions grant` first'))).toBe(true)
  })

  it('ignores successes, other tools and DreamCoder session rejections', () => {
    expect(isCuaPermissionError('mcp__cua__click', { content: 'Accessibility', isError: false })).toBe(false)
    expect(isCuaPermissionError('Bash', err('Accessibility is not granted'))).toBe(false)
    expect(
      isCuaPermissionError(
        'mcp__cua__click',
        err("Claude requested permissions to use mcp__cua__click, but you haven't granted it yet."),
      ),
    ).toBe(false)
  })
})

