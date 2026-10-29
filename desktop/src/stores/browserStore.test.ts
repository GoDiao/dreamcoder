import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_BROWSER_PAGE, useBrowserStore } from './browserStore'

describe('browserStore', () => {
  const initialState = useBrowserStore.getInitialState()

  afterEach(() => {
    useBrowserStore.setState(initialState, true)
  })

  it('keeps one page per tab and merges patches into it', () => {
    const { patchPage } = useBrowserStore.getState()
    patchPage('a', { loading: true })
    patchPage('b', { canGoForward: true })
    patchPage('a', { loading: false, canGoBack: true })

    expect(useBrowserStore.getState().pageByTab).toEqual({
      a: { ...EMPTY_BROWSER_PAGE, canGoBack: true },
      b: { ...EMPTY_BROWSER_PAGE, canGoForward: true },
    })
  })

  it('sets and clears a notice for one tab', () => {
    const { setNotice } = useBrowserStore.getState()
    setNotice('a', { kind: 'refused', reason: 'scheme', url: 'http://example.com' })
    setNotice('b', { kind: 'loadFailed', url: 'http://localhost:1', description: 'refused' })
    setNotice('a', null)

    expect(Object.keys(useBrowserStore.getState().noticeByTab)).toEqual(['b'])
  })

  it('forgets a tab without touching the others', () => {
    const { patchPage, setNotice, clearTab } = useBrowserStore.getState()
    patchPage('a', { loading: true })
    patchPage('b', { loading: true })
    setNotice('a', { kind: 'refused', reason: 'notFound' })
    clearTab('a')

    const state = useBrowserStore.getState()
    expect(Object.keys(state.pageByTab)).toEqual(['b'])
    expect(state.noticeByTab).toEqual({})
  })
})
