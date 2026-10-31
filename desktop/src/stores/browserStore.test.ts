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
    const { patchPage, setNotice, setPickActive, clearTab } = useBrowserStore.getState()
    patchPage('a', { loading: true })
    patchPage('b', { loading: true })
    setNotice('a', { kind: 'refused', reason: 'notFound' })
    setPickActive('a', true)
    setPickActive('b', true)
    clearTab('a')

    const state = useBrowserStore.getState()
    expect(Object.keys(state.pageByTab)).toEqual(['b'])
    expect(state.noticeByTab).toEqual({})
    expect(state.pickActiveByTab).toEqual({ b: true })
  })

  it('tracks whether a tab is in pick mode', () => {
    const { setPickActive } = useBrowserStore.getState()
    setPickActive('a', true)
    setPickActive('b', true)
    setPickActive('a', false)

    expect(useBrowserStore.getState().pickActiveByTab).toEqual({ b: true })
  })

  it('starts a page as not ready', () => {
    useBrowserStore.getState().patchPage('a', { loading: true })
    expect(useBrowserStore.getState().pageByTab.a?.ready).toBe(false)
  })
})
