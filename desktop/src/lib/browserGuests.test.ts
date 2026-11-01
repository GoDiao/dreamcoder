import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_PARTITION } from './shell/electronBridge'

const shellMocks = vi.hoisted(() => ({
  resolveBrowserInput: vi.fn(),
  registerBrowserView: vi.fn(),
  updateBrowserView: vi.fn(),
  unregisterBrowserView: vi.fn(),
}))

vi.mock('./shell', () => ({
  resolveBrowserInput: shellMocks.resolveBrowserInput,
  registerBrowserView: shellMocks.registerBrowserView,
  updateBrowserView: shellMocks.updateBrowserView,
  unregisterBrowserView: shellMocks.unregisterBrowserView,
}))

import {
  addBrowserSelectionToChat,
  browserGoBack,
  browserReload,
  closeBrowser,
  openBrowserUrl,
  placeBrowserGuest,
  replayBrowserShortcut,
  setBrowserGuestLayer,
  showBlockedNavigation,
  submitBrowserInput,
} from './browserGuests'
import { useBrowserStore } from '../stores/browserStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'
import { useWorkspacePanelStore } from '../stores/workspacePanelStore'

type FakeWebview = HTMLElement & {
  loadURL: ReturnType<typeof vi.fn>
  goBack: ReturnType<typeof vi.fn>
  reload: ReturnType<typeof vi.fn>
  getURL: ReturnType<typeof vi.fn>
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed: Element[] = []
  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this)
  }
  observe(element: Element) {
    this.observed.push(element)
  }
  disconnect() {
    this.observed = []
  }
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }
}

function stageAt(left: number, top: number, width: number, height: number) {
  const stage = document.createElement('div')
  document.body.appendChild(stage)
  stage.getBoundingClientRect = () => rect(left, top, width, height)
  return stage
}

function webviewOf(tabId: string) {
  const slot = document.querySelector<HTMLElement>(`[data-browser-slot="${tabId}"]`)
  if (!slot) throw new Error(`no slot for ${tabId}`)
  const webview = slot.querySelector('webview') as FakeWebview
  return { slot, webview }
}

function makeReady(tabId: string, state: { url?: string; id?: number } = {}) {
  const { webview } = webviewOf(tabId)
  Object.assign(webview, {
    loadURL: vi.fn(async () => {}),
    goBack: vi.fn(),
    reload: vi.fn(),
    getURL: vi.fn(() => state.url ?? 'https://example.com/'),
    getTitle: vi.fn(() => 'Title'),
    isLoading: vi.fn(() => false),
    canGoBack: vi.fn(() => true),
    canGoForward: vi.fn(() => false),
    getWebContentsId: vi.fn(() => state.id ?? 11),
  })
  webview.dispatchEvent(new Event('dom-ready'))
  return webview
}

function failLoad(webview: HTMLElement, fields: Record<string, unknown>) {
  webview.dispatchEvent(Object.assign(new Event('did-fail-load'), fields))
}

let layer: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  FakeResizeObserver.instances = []
  shellMocks.registerBrowserView.mockResolvedValue(undefined)
  shellMocks.updateBrowserView.mockResolvedValue(undefined)
  shellMocks.unregisterBrowserView.mockResolvedValue(undefined)
  layer = document.createElement('div')
  layer.getBoundingClientRect = () => rect(0, 0, 1200, 800)
  document.body.appendChild(layer)
  setBrowserGuestLayer(layer)
  useWorkspacePanelStore.setState({
    panelBySession: {
      s: {
        isOpen: true,
        expanded: false,
        activeTabId: 'a',
        recentFiles: [],
        tabs: [
          { id: 'a', kind: 'browser', url: '', title: '' },
          { id: 'b', kind: 'browser', url: '', title: '' },
        ],
      },
    },
  })
})

function browserTab(tabId: string) {
  return useWorkspacePanelStore.getState().panelBySession.s?.tabs.find((tab) => tab.id === tabId)
}

afterEach(() => {
  closeBrowser('a')
  closeBrowser('b')
  setBrowserGuestLayer(null)
  document.body.innerHTML = ''
  useBrowserStore.setState(useBrowserStore.getInitialState(), true)
  useWorkspacePanelStore.setState({ panelBySession: {} })
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('browser guests', () => {
  it('creates a webview in the layer with the browsing partition and the first address', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')

    const { slot, webview } = webviewOf('a')
    expect(slot.parentElement).toBe(layer)
    expect(webview.getAttribute('partition')).toBe(BROWSER_PARTITION)
    expect(webview.getAttribute('src')).toBe('https://example.com/')
    expect(webview.hasAttribute('allowpopups')).toBe(true)
    expect(webview.hasAttribute('preload')).toBe(false)
  })

  it('navigates a ready guest in place and changes src before it is ready', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    const { webview } = webviewOf('a')
    openBrowserUrl('s', 'a', 'http://localhost:3000/')
    expect(webview.getAttribute('src')).toBe('http://localhost:3000/')

    makeReady('a')
    openBrowserUrl('s', 'a', 'https://other.test/')
    expect(webview.loadURL).toHaveBeenCalledWith('https://other.test/')
    expect(document.querySelectorAll('webview')).toHaveLength(1)
  })

  it('fails visibly when there is no layer to host the page', () => {
    setBrowserGuestLayer(null)
    expect(() => openBrowserUrl('s', 'a', 'https://example.com/')).toThrow('Browser layer is not mounted')
  })

  it('draws a page over its stage and parks it when released, without moving the element', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    openBrowserUrl('s', 'b', 'https://b.test/')
    const first = webviewOf('a')
    const second = webviewOf('b')

    const releaseA = placeBrowserGuest('a', stageAt(300, 100, 400, 500), true)
    expect(first.slot.style.cssText).toContain('left: 300px')
    expect(first.slot.style.cssText).toContain('top: 100px')
    expect(first.slot.style.cssText).toContain('width: 400px')
    expect(first.slot.dataset.shown).toBe('true')
    expect(first.slot.style.pointerEvents).toBe('auto')
    expect(second.slot.dataset.shown).toBe('false')

    releaseA()
    expect(first.slot.dataset.shown).toBe('false')
    expect(first.slot.style.visibility).toBe('hidden')
    placeBrowserGuest('b', stageAt(300, 100, 400, 500), true)
    expect(second.slot.dataset.shown).toBe('true')
    expect(first.slot.parentElement).toBe(layer)
    expect(second.slot.parentElement).toBe(layer)
    expect(webviewOf('a').webview).toBe(first.webview)
  })

  it('places a page that is created after its stage', () => {
    placeBrowserGuest('a', stageAt(10, 20, 300, 200), true)
    openBrowserUrl('s', 'a', 'https://example.com/')

    const { slot } = webviewOf('a')
    expect(slot.dataset.shown).toBe('true')
    expect(slot.style.width).toBe('300px')
  })

  it('hides a page whose stage has no size and follows the stage and its ancestors', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    const stage = stageAt(0, 0, 0, 0)
    placeBrowserGuest('a', stage, true)
    expect(webviewOf('a').slot.dataset.shown).toBe('false')

    stage.getBoundingClientRect = () => rect(50, 60, 200, 100)
    const observer = FakeResizeObserver.instances.find((instance) => instance.observed.includes(stage))
    expect(observer?.observed).toContain(document.body)
    observer?.callback()
    expect(webviewOf('a').slot.dataset.shown).toBe('true')
    expect(webviewOf('a').slot.style.left).toBe('50px')
  })

  it('only releases the placement it made', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    const releaseOld = placeBrowserGuest('a', stageAt(0, 0, 100, 100), true)
    placeBrowserGuest('a', stageAt(0, 0, 200, 100), true)
    releaseOld()
    expect(webviewOf('a').slot.dataset.shown).toBe('true')
  })

  it('mirrors the address and title into the tab and the controls into the store, ignoring error pages', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    const current = { url: 'https://example.com/' }
    const webview = makeReady('a', current)

    expect(browserTab('a')).toEqual({ id: 'a', kind: 'browser', url: 'https://example.com/', title: 'Title' })
    expect(useBrowserStore.getState().pageByTab.a).toEqual({
      ready: true,
      loading: false,
      canGoBack: true,
      canGoForward: false,
    })

    webview.dispatchEvent(new Event('did-start-loading'))
    expect(useBrowserStore.getState().pageByTab.a?.loading).toBe(true)

    useBrowserStore.getState().setNotice('a', { kind: 'loadFailed', url: 'http://localhost:1/', description: 'ERR_CONNECTION_REFUSED' })
    current.url = 'chrome-error://chromewebdata/'
    webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'chrome-error://chromewebdata/' }))
    expect(browserTab('a')).toMatchObject({ url: 'https://example.com/' })
    expect(useBrowserStore.getState().noticeByTab.a).toBeDefined()

    current.url = 'http://localhost:3000/'
    webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'http://localhost:3000/' }))
    expect(browserTab('a')).toMatchObject({ url: 'http://localhost:3000/' })
    expect(browserTab('b')).toMatchObject({ url: '' })
  })

  it('shows a notice for main-frame load failures only', () => {
    openBrowserUrl('s', 'a', 'http://localhost:3000/')
    const webview = makeReady('a')

    failLoad(webview, { isMainFrame: false, errorCode: -105, errorDescription: 'x', validatedURL: 'http://a/' })
    failLoad(webview, { isMainFrame: true, errorCode: -3, errorDescription: 'ERR_ABORTED', validatedURL: 'http://a/' })
    expect(useBrowserStore.getState().noticeByTab.a).toBeUndefined()

    failLoad(webview, { isMainFrame: true, errorCode: -102, errorDescription: 'ERR_CONNECTION_REFUSED', validatedURL: 'http://localhost:3000/' })
    expect(useBrowserStore.getState().noticeByTab.a).toEqual({
      kind: 'loadFailed',
      url: 'http://localhost:3000/',
      description: 'ERR_CONNECTION_REFUSED',
    })

    webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'http://localhost:3000/ok' }))
    expect(useBrowserStore.getState().noticeByTab.a).toBeUndefined()
  })

  it('shows refusals from the main process on the tab that owns the guest', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    openBrowserUrl('s', 'b', 'https://b.test/')
    makeReady('a', { id: 11 })
    makeReady('b', { id: 22 })

    showBlockedNavigation({ guestId: 22, url: 'http://evil.test/', reason: 'scheme' })

    expect(useBrowserStore.getState().noticeByTab).toEqual({
      b: { kind: 'refused', reason: 'scheme', url: 'http://evil.test/' },
    })
  })

  it('adds a selection from the main process to the session that owns the guest', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    openBrowserUrl('t', 'b', 'https://b.test/')
    makeReady('a', { id: 11 })
    makeReady('b', { id: 22 })

    addBrowserSelectionToChat({ guestId: 22, text: ' picked  text ', truncated: false, title: 'B page', url: 'https://b.test/x' })
    addBrowserSelectionToChat({ guestId: 99, text: 'nobody', truncated: false, title: '', url: '' })
    addBrowserSelectionToChat({ guestId: 11, text: '   ', truncated: false, title: '', url: '' })

    const references = useWorkspaceChatContextStore.getState().referencesBySession
    expect(references.s).toBeUndefined()
    expect(references.t).toMatchObject([{
      kind: 'browser',
      path: 'https://b.test/x',
      name: 'B page',
      browser: { url: 'https://b.test/x', title: 'B page', tabId: 'b', text: 'picked text', truncated: false },
    }])
  })

  it('marks the picked elements of a tab stale when the page navigates, but not on in-page changes or other tabs', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    openBrowserUrl('s', 'b', 'https://b.test/')
    const webview = makeReady('a')
    makeReady('b', { id: 22 })
    const pick = (tabId: string, ref: string) => ({
      kind: 'browser' as const,
      path: `https://${tabId}.test/`,
      name: ref,
      browser: {
        url: `https://${tabId}.test/`,
        title: '',
        tabId,
        text: '',
        truncated: false,
        element: { ref, generation: 0, tag: 'b', label: 'b', role: '', name: '', selector: ref, sensitive: false, stale: false },
      },
    })
    useWorkspaceChatContextStore.getState().addReference('s', pick('a', '1'))
    useWorkspaceChatContextStore.getState().addReference('s', pick('b', '2'))
    const stale = () => (useWorkspaceChatContextStore.getState().referencesBySession.s ?? []).map((reference) => reference.browser?.element?.stale)

    webview.dispatchEvent(new Event('did-navigate-in-page'))
    expect(stale()).toEqual([false, false])

    webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'https://example.com/next' }))
    expect(stale()).toEqual([true, false])
  })

  it('marks the picked elements stale when the navigation lands on an error page', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    const webview = makeReady('a')
    useWorkspaceChatContextStore.getState().addReference('s', {
      kind: 'browser',
      path: 'https://example.com/',
      name: '1',
      browser: {
        url: 'https://example.com/',
        title: '',
        tabId: 'a',
        text: '',
        truncated: false,
        element: { ref: '1', generation: 0, tag: 'b', label: 'b', role: '', name: '', selector: '1', sensitive: false, stale: false },
      },
    })
    webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'chrome-error://chromewebdata/' }))
    expect(useWorkspaceChatContextStore.getState().referencesBySession.s?.[0]?.browser?.element?.stale).toBe(true)
  })

  it('marks the picked elements stale when their browser tab is closed', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    makeReady('a')
    useWorkspaceChatContextStore.getState().addReference('s', {
      kind: 'browser',
      path: 'https://example.com/',
      name: '1',
      browser: {
        url: 'https://example.com/',
        title: '',
        tabId: 'a',
        text: '',
        truncated: false,
        element: { ref: '1', generation: 0, tag: 'b', label: 'b', role: '', name: '', selector: '1', sensitive: false, stale: false },
      },
    })
    closeBrowser('a')
    expect(useWorkspaceChatContextStore.getState().referencesBySession.s?.[0]?.browser?.element?.stale).toBe(true)
  })

  it('drives back and reload on ready guests only', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    const { webview } = webviewOf('a')
    browserGoBack('a')
    browserReload('a')
    const ready = makeReady('a')
    expect(ready).toBe(webview)
    browserGoBack('a')
    browserReload('a')
    expect(webview.goBack).toHaveBeenCalledOnce()
    expect(webview.reload).toHaveBeenCalledOnce()
  })

  it('removes the page and its state when the browser is closed', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    makeReady('a')
    closeBrowser('a')

    expect(document.querySelector('[data-browser-slot="a"]')).toBeNull()
    expect(useBrowserStore.getState().pageByTab.a).toBeUndefined()
  })
})

describe('browser view reports', () => {
  it('registers the guest with the main process once it is ready', async () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    expect(shellMocks.registerBrowserView).not.toHaveBeenCalled()

    const webview = makeReady('a', { id: 31 })
    webview.dispatchEvent(new Event('dom-ready'))

    expect(shellMocks.registerBrowserView).toHaveBeenCalledOnce()
    expect(shellMocks.registerBrowserView).toHaveBeenCalledWith({ sessionId: 's', tabId: 'a', webContentsId: 31 })
  })

  it('unregisters the guest when the browser is closed, and not for a guest that never registered', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    openBrowserUrl('s', 'b', 'https://b.test/')
    makeReady('a')

    closeBrowser('b')
    expect(shellMocks.unregisterBrowserView).not.toHaveBeenCalled()
    closeBrowser('a')
    expect(shellMocks.unregisterBrowserView).toHaveBeenCalledOnce()
    expect(shellMocks.unregisterBrowserView).toHaveBeenCalledWith({ tabId: 'a' })
  })

  it('reports when a registered guest becomes shown or hidden', async () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    makeReady('a')
    await vi.waitFor(() => expect(shellMocks.updateBrowserView).toHaveBeenCalledOnce())
    expect(shellMocks.updateBrowserView).toHaveBeenLastCalledWith({ tabId: 'a', shown: false, active: true, foreground: false })

    const release = placeBrowserGuest('a', stageAt(0, 0, 400, 300), true)
    expect(shellMocks.updateBrowserView).toHaveBeenLastCalledWith({ tabId: 'a', shown: true, active: true, foreground: false })

    release()
    expect(shellMocks.updateBrowserView).toHaveBeenLastCalledWith({ tabId: 'a', shown: false, active: true, foreground: false })
    expect(shellMocks.updateBrowserView).toHaveBeenCalledTimes(3)
  })
})

describe('browser input', () => {
  it('opens the address the main process resolved', async () => {
    shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: 'http://localhost:3000/' })
    await submitBrowserInput('s', 'a', 'localhost:3000', '/repo')

    expect(shellMocks.resolveBrowserInput).toHaveBeenCalledWith({ input: 'localhost:3000', projectRoot: '/repo', searchEngine: 'bing' })
    expect(webviewOf('a').webview.getAttribute('src')).toBe('http://localhost:3000/')
  })

  it('sends the engine chosen in settings with the input', async () => {
    useSettingsStore.setState({ browserSearchEngine: 'baidu' })
    shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: 'https://www.baidu.com/s?wd=%E5%A4%A9%E6%B0%94' })
    await submitBrowserInput('s', 'a', '天气', '/repo')

    expect(shellMocks.resolveBrowserInput).toHaveBeenCalledWith({ input: '天气', projectRoot: '/repo', searchEngine: 'baidu' })
    expect(webviewOf('a').webview.getAttribute('src')).toBe('https://www.baidu.com/s?wd=%E5%A4%A9%E6%B0%94')
  })

  it('shows the refusal and opens nothing', async () => {
    shellMocks.resolveBrowserInput.mockResolvedValue({ ok: false, reason: 'scheme' })
    await submitBrowserInput('s', 'a', 'http://example.com', null)

    expect(useBrowserStore.getState().noticeByTab.a).toEqual({ kind: 'refused', reason: 'scheme', url: 'http://example.com' })
    expect(document.querySelector('webview')).toBeNull()
  })

  it('clears an earlier notice once an address is accepted', async () => {
    useBrowserStore.getState().setNotice('a', { kind: 'refused', reason: 'scheme' })
    shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: 'https://example.com/' })
    await submitBrowserInput('s', 'a', 'example.com', null)

    expect(useBrowserStore.getState().noticeByTab.a).toBeUndefined()
  })
})

describe('app interaction while a page is shown', () => {
  it('closes open app popups when focus moves into a page, without starting a drag', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    placeBrowserGuest('a', stageAt(0, 0, 400, 300), true)
    const pointerdown = vi.fn()
    document.addEventListener('pointerdown', pointerdown)

    webviewOf('a').webview.dispatchEvent(new Event('focus'))

    expect(pointerdown).toHaveBeenCalledOnce()
    expect(webviewOf('a').slot.style.pointerEvents).toBe('auto')
    document.removeEventListener('pointerdown', pointerdown)
  })

  it('stops pages taking pointer events during an app drag and gives them back after', () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    placeBrowserGuest('a', stageAt(0, 0, 400, 300), true)
    const { slot } = webviewOf('a')

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(slot.style.pointerEvents).toBe('none')
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(slot.style.pointerEvents).toBe('auto')

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(slot.style.pointerEvents).toBe('none')
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 0 }))
    expect(slot.style.pointerEvents).toBe('auto')
  })

  it('replays forwarded shortcuts as key events for the app handlers', () => {
    const handler = vi.fn()
    document.addEventListener('keydown', handler)

    replayBrowserShortcut({ key: 'k', code: 'KeyK', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })

    const event = handler.mock.calls[0]?.[0] as KeyboardEvent
    expect(event).toMatchObject({ key: 'k', code: 'KeyK', metaKey: true, ctrlKey: false })
    document.removeEventListener('keydown', handler)
  })
})
