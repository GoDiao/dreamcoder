import { describe, expect, it } from 'vitest'
import {
  UI_PAGE_ERROR_MAX_LENGTH,
  UI_PAGE_MAX_HEIGHT,
  UI_PAGE_MIN_HEIGHT,
  buildHostContext,
  clampFrameHeight,
  isFromFrame,
  parseUiPageMessage,
  parseUiPageResult,
  uiPageUrl,
} from './uiPageBridge'

const rpc = (message: Record<string, unknown>) => ({ jsonrpc: '2.0', ...message })

describe('page messages', () => {
  it('accepts ready, resize and error with the MCP Apps method names', () => {
    expect(parseUiPageMessage(rpc({ id: 1, method: 'ui/initialize', params: {} }))).toEqual({ kind: 'initialize', id: 1 })
    expect(parseUiPageMessage(rpc({ method: 'ui/notifications/initialized' }))).toEqual({ kind: 'initialized' })
    expect(parseUiPageMessage(rpc({ method: 'ui/notifications/size-changed', params: { width: 300, height: 410.4 } })))
      .toEqual({ kind: 'resize', height: 410.4 })
    expect(parseUiPageMessage(rpc({ method: 'notifications/message', params: { level: 'error', data: 'boom' } })))
      .toEqual({ kind: 'error', message: 'boom' })
  })

  it('drops every other method, including the ones MCP Apps defines for calling the host', () => {
    for (const method of [
      'tools/call',
      'ui/message',
      'ui/open-link',
      'ui/update-model-context',
      'ui/request-display-mode',
      'resources/read',
      'ui/notifications/sandbox-proxy-ready',
      'ui/resource-teardown',
    ]) {
      expect(parseUiPageMessage(rpc({ id: 2, method, params: { url: 'https://example.com', content: [] } }))).toBeNull()
      expect(parseUiPageMessage(rpc({ method, params: {} }))).toBeNull()
    }
  })

  it('drops malformed envelopes and values', () => {
    expect(parseUiPageMessage(null)).toBeNull()
    expect(parseUiPageMessage('ui/initialize')).toBeNull()
    expect(parseUiPageMessage([])).toBeNull()
    expect(parseUiPageMessage({ method: 'ui/notifications/initialized' })).toBeNull()
    expect(parseUiPageMessage({ jsonrpc: '1.0', method: 'ui/notifications/initialized' })).toBeNull()
    expect(parseUiPageMessage(rpc({ method: 7 }))).toBeNull()
    expect(parseUiPageMessage(rpc({ method: 'ui/initialize' }))).toBeNull()
    expect(parseUiPageMessage(rpc({ id: {}, method: 'ui/initialize' }))).toBeNull()
    expect(parseUiPageMessage(rpc({ id: 3, method: 'ui/notifications/initialized' }))).toBeNull()
    expect(parseUiPageMessage(rpc({ method: 'ui/notifications/size-changed', params: { height: '300' } }))).toBeNull()
    expect(parseUiPageMessage(rpc({ method: 'ui/notifications/size-changed', params: { height: -1 } }))).toBeNull()
    expect(parseUiPageMessage(rpc({ method: 'ui/notifications/size-changed', params: { height: Infinity } }))).toBeNull()
    expect(parseUiPageMessage(rpc({ method: 'ui/notifications/size-changed', params: { height: Number.NaN } }))).toBeNull()
    expect(parseUiPageMessage(rpc({ method: 'ui/notifications/size-changed' }))).toBeNull()
  })

  it('ignores log messages below error and caps the text of an error', () => {
    expect(parseUiPageMessage(rpc({ method: 'notifications/message', params: { level: 'info', data: 'hi' } }))).toBeNull()
    expect(parseUiPageMessage(rpc({ method: 'notifications/message', params: { data: 'hi' } }))).toBeNull()
    const long = parseUiPageMessage(rpc({ method: 'notifications/message', params: { level: 'error', data: 'x'.repeat(5000) } }))
    expect(long).toEqual({ kind: 'error', message: 'x'.repeat(UI_PAGE_ERROR_MAX_LENGTH) })
  })
})

describe('frame source check', () => {
  it('accepts only the window of the frame itself', () => {
    const frame = {} as Window
    expect(isFromFrame({ source: frame }, frame)).toBe(true)
    expect(isFromFrame({ source: {} as Window }, frame)).toBe(false)
    expect(isFromFrame({ source: window }, frame)).toBe(false)
    expect(isFromFrame({ source: null }, frame)).toBe(false)
    expect(isFromFrame({ source: null }, null)).toBe(false)
    expect(isFromFrame({ source: window }, undefined)).toBe(false)
  })
})

describe('frame height', () => {
  it('stays between the minimum and the maximum', () => {
    expect(clampFrameHeight(0)).toBe(UI_PAGE_MIN_HEIGHT)
    expect(clampFrameHeight(1000, 900)).toBe(900)
    expect(clampFrameHeight(300.2)).toBe(301)
    expect(clampFrameHeight(1e9)).toBe(UI_PAGE_MAX_HEIGHT)
  })
})

describe('host context', () => {
  it('passes the app theme as light or dark', () => {
    expect(buildHostContext('midnight').theme).toBe('dark')
    expect(buildHostContext('light').theme).toBe('light')
  })
})

describe('page result and url', () => {
  const pageId = 'a1b2c3d4e5f6a1b2c3d4e5f6'

  it('reads the page out of a tool result', () => {
    const content = JSON.stringify({ pageId, revision: 3, title: 'Login page' })
    expect(parseUiPageResult(content)).toEqual({ pageId, revision: 3, title: 'Login page' })
    expect(parseUiPageResult([{ type: 'text', text: content }])).toEqual({ pageId, revision: 3, title: 'Login page' })
  })

  it('refuses results that are not a page', () => {
    expect(parseUiPageResult('Page saved')).toBeNull()
    expect(parseUiPageResult(undefined)).toBeNull()
    expect(parseUiPageResult(JSON.stringify({ pageId: '../x', revision: 1 }))).toBeNull()
    expect(parseUiPageResult(JSON.stringify({ pageId, revision: 0 }))).toBeNull()
    expect(parseUiPageResult(JSON.stringify({ pageId, revision: 1.5 }))).toBeNull()
    expect(parseUiPageResult(JSON.stringify([pageId]))).toBeNull()
  })

  it('builds the page address on the sidecar', () => {
    expect(uiPageUrl('http://127.0.0.1:3456/', 's 1', pageId, 2)).toBe(`http://127.0.0.1:3456/ui-pages/s%201/${pageId}/2`)
  })
})
