import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_PARTITION } from './shell/electronBridge'

const artifactApiMocks = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), openById: vi.fn(), previewTemplate: vi.fn() }))

vi.mock('../api/artifacts', () => ({ artifactsApi: { list: artifactApiMocks.list, open: artifactApiMocks.open, openById: artifactApiMocks.openById } }))
vi.mock('../api/design', () => ({ designApi: { preview: artifactApiMocks.previewTemplate } }))

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
  artifactReferenceLabel,
  browserGoBack,
  browserGuestSize,
  browserReload,
  closeBrowser,
  deckStageRect,
  openBrowserUrl,
  placeBrowserGuest,
  presentDeck,
  refreshArtifactShell,
  replayBrowserShortcut,
  resolveStoredBrowserUrl,
  setBrowserGuestLayer,
  setCanvasMessageHandler,
  showBlockedNavigation,
  submitBrowserInput,
} from './browserGuests'
import { useBrowserStore } from '../stores/browserStore'
import { useUIStore } from '../stores/uiStore'
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

function makeReady(tabId: string, state: { url?: string; id?: number; execute?: (code: string) => Promise<unknown> } = {}) {
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
    executeJavaScript: state.execute ?? vi.fn(async () => undefined),
    focus: vi.fn(),
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
    panelByTab: {
      s: {
        isOpen: true,
        expanded: false,
        activeTabId: 'a',
        recentFiles: [], selectedFile: null,
        tabs: [
          { id: 'a', kind: 'browser', url: '', title: '' },
          { id: 'b', kind: 'browser', url: '', title: '' },
        ],
      },
    },
  })
})

function browserTab(tabId: string) {
  return useWorkspacePanelStore.getState().panelByTab.s?.tabs.find((tab) => tab.id === tabId)
}

afterEach(() => {
  closeBrowser('a')
  closeBrowser('b')
  setBrowserGuestLayer(null)
  document.body.innerHTML = ''
  useBrowserStore.setState(useBrowserStore.getInitialState(), true)
  useWorkspacePanelStore.setState({ panelByTab: {} })
  useWorkspaceChatContextStore.setState(useWorkspaceChatContextStore.getInitialState(), true)
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
      deck: null,
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

  it('adds a selection from the main process to the session that owns the guest', async () => {
    openBrowserUrl('s', 'a', 'https://example.com/')
    openBrowserUrl('t', 'b', 'https://b.test/')
    makeReady('a', { id: 11 })
    makeReady('b', { id: 22 })

    await addBrowserSelectionToChat({ guestId: 22, text: ' picked  text ', truncated: false, title: 'B page', url: 'https://b.test/x' })
    await addBrowserSelectionToChat({ guestId: 99, text: 'nobody', truncated: false, title: '', url: '' })
    await addBrowserSelectionToChat({ guestId: 11, text: '   ', truncated: false, title: '', url: '' })

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

describe('resolveStoredBrowserUrl', () => {
  it('leaves web addresses alone', async () => {
    expect(await resolveStoredBrowserUrl({ url: 'https://example.com/a' }, '/repo')).toBe('https://example.com/a')
    expect(shellMocks.resolveBrowserInput).not.toHaveBeenCalled()
  })

  it('rebuilds a project page address from the stored root after a restart', async () => {
    shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: 'dreamcoder-project://fresh/report/a%20b.html' })
    const url = await resolveStoredBrowserUrl({ url: 'dreamcoder-project://stale/report/a%20b.html', root: '/other/dc_artifacts' }, '/repo')

    expect(url).toBe('dreamcoder-project://fresh/report/a%20b.html')
    expect(shellMocks.resolveBrowserInput).toHaveBeenCalledWith({
      input: '/other/dc_artifacts/report/a b.html',
      projectRoot: '/other/dc_artifacts',
      searchEngine: 'bing',
    })
  })

  it('uses the session folder for a project page that has no stored root', async () => {
    shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: 'dreamcoder-project://fresh/docs/index.html' })
    await resolveStoredBrowserUrl({ url: 'dreamcoder-project://stale/docs/index.html' }, '/repo/')
    expect(shellMocks.resolveBrowserInput).toHaveBeenCalledWith(expect.objectContaining({ input: '/repo/docs/index.html', projectRoot: '/repo/' }))
  })

  it('finds an artifact by id when its stored root is gone, keeping the path inside the artifact', async () => {
    artifactApiMocks.openById.mockResolvedValue({ rootDir: '/config/global/dc_artifacts', filePath: '/config/global/dc_artifacts/moved-2/index.html' })
    shellMocks.resolveBrowserInput
      .mockResolvedValueOnce({ ok: false, reason: 'notFound' })
      .mockResolvedValueOnce({ ok: true, url: 'dreamcoder-project://fresh/moved-2/pages/b.html' })

    const url = await resolveStoredBrowserUrl(
      { url: 'dreamcoder-project://stale/moved/pages/b.html', root: '/gone/dc_artifacts', artifact: { id: 'stable-id' } },
      '/repo',
    )

    expect(url).toBe('dreamcoder-project://fresh/moved-2/pages/b.html')
    expect(artifactApiMocks.openById).toHaveBeenCalledWith('stable-id')
    expect(shellMocks.resolveBrowserInput).toHaveBeenLastCalledWith(expect.objectContaining({
      input: '/config/global/dc_artifacts/moved-2/pages/b.html',
      projectRoot: '/config/global/dc_artifacts',
    }))
  })

  it('finds a template preview by id when the app moved and its stored root is gone', async () => {
    artifactApiMocks.previewTemplate.mockResolvedValue({ rootDir: '/new/design-templates/saas', filePath: '/new/design-templates/saas/index.html' })
    shellMocks.resolveBrowserInput
      .mockResolvedValueOnce({ ok: false, reason: 'notFound' })
      .mockResolvedValueOnce({ ok: true, url: 'dreamcoder-project://fresh/index.html' })

    const url = await resolveStoredBrowserUrl(
      { url: 'dreamcoder-project://stale/index.html', root: '/old/design-templates/saas', template: { id: 'saas' } },
      '/repo',
    )

    expect(url).toBe('dreamcoder-project://fresh/index.html')
    expect(artifactApiMocks.previewTemplate).toHaveBeenCalledWith('saas')
    expect(shellMocks.resolveBrowserInput).toHaveBeenLastCalledWith(expect.objectContaining({
      input: '/new/design-templates/saas/index.html',
      projectRoot: '/new/design-templates/saas',
    }))
  })

  it('goes straight to the id for an artifact in the global store marker', async () => {
    artifactApiMocks.openById.mockResolvedValue({ rootDir: '/config/global/dc_artifacts', filePath: '/config/global/dc_artifacts/moved/index.html' })
    shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: 'dreamcoder-project://fresh/moved/index.html' })

    await resolveStoredBrowserUrl({ url: 'dreamcoder-project://stale/moved/index.html', root: 'global', artifact: { id: 'x' } }, '/repo')

    expect(shellMocks.resolveBrowserInput).toHaveBeenCalledTimes(1)
    expect(artifactApiMocks.openById).toHaveBeenCalledWith('x')
  })

  it('keeps the part after # of the stored address, so a deck reopens on the slide it was showing', async () => {
    shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: 'dreamcoder-project://fresh/talk/index.html' })
    const url = await resolveStoredBrowserUrl({ url: 'dreamcoder-project://stale/talk/index.html#agenda', root: '/repo/dc_artifacts' }, '/repo')

    expect(url).toBe('dreamcoder-project://fresh/talk/index.html#agenda')
    expect(shellMocks.resolveBrowserInput).toHaveBeenCalledWith(expect.objectContaining({ input: '/repo/dc_artifacts/talk/index.html' }))
  })

  it('keeps the stored address when there is no root to resolve against or the page is gone', async () => {
    expect(await resolveStoredBrowserUrl({ url: 'dreamcoder-project://stale/a.html' }, null)).toBe('dreamcoder-project://stale/a.html')
    shellMocks.resolveBrowserInput.mockResolvedValue({ ok: false, reason: 'notFound' })
    expect(await resolveStoredBrowserUrl({ url: 'dreamcoder-project://stale/a.html', root: '/r' }, null)).toBe('dreamcoder-project://stale/a.html')
  })
})

describe('a page that belongs to no chat', () => {
  it('is never registered with the browser host, so no chat or agent can reach it', async () => {
    openBrowserUrl(null, 'viewer', 'https://example.com/')
    makeReady('viewer', { id: 31 })
    await Promise.resolve()

    expect(shellMocks.registerBrowserView).not.toHaveBeenCalled()
    expect(shellMocks.updateBrowserView).not.toHaveBeenCalled()
  })

  it('does not touch any panel tab or chat context when it navigates, is closed or has text selected', () => {
    openBrowserUrl(null, 'viewer', 'https://example.com/')
    const webview = makeReady('viewer', { id: 31 })
    const panels = useWorkspacePanelStore.getState().panelByTab
    const references = useWorkspaceChatContextStore.getState().referencesBySession

    webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'https://example.com/next' }))
    addBrowserSelectionToChat({ guestId: 31, text: 'picked', truncated: false, title: 'T', url: 'https://example.com/' })
    closeBrowser('viewer')

    expect(useWorkspacePanelStore.getState().panelByTab).toBe(panels)
    expect(useWorkspaceChatContextStore.getState().referencesBySession).toBe(references)
  })

  it('opens an address like any other page', async () => {
    shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: 'dreamcoder-project://id/a/index.html' })
    await submitBrowserInput(null, 'viewer', '/repo/dc_artifacts/a/index.html', '/repo/dc_artifacts')
    expect(webviewOf('viewer').webview.getAttribute('src')).toBe('dreamcoder-project://id/a/index.html')
  })
})

describe('canvas pages', () => {
  const SCRIPT = 'dreamcoder-project://abc/__dreamcoder__/canvas.js'
  const log = (webview: HTMLElement, message: string, sourceId: string) => webview.dispatchEvent(Object.assign(new Event('console-message'), { message, sourceId }))

  afterEach(() => {
    setCanvasMessageHandler('a', null)
  })

  it('passes the messages the canvas script logs to the handler of the tab', () => {
    openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
    const handler = vi.fn()
    setCanvasMessageHandler('a', handler)
    log(webviewOf('a').webview, 'dreamcoder-canvas:{"type":"open","id":"home"}', SCRIPT)
    expect(handler).toHaveBeenCalledWith({ type: 'open', id: 'home' })
  })

  it('ignores messages from other scripts, other logs, other tabs and a tab without a handler', () => {
    openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
    openBrowserUrl('s', 'b', 'dreamcoder-project://abc/flow/index.html')
    const handler = vi.fn()
    setCanvasMessageHandler('a', handler)
    log(webviewOf('a').webview, 'dreamcoder-canvas:{"type":"open","id":"home"}', 'dreamcoder-project://abc/flow/home.html')
    log(webviewOf('a').webview, 'just a log', SCRIPT)
    log(webviewOf('b').webview, 'dreamcoder-canvas:{"type":"open","id":"home"}', SCRIPT)
    expect(handler).not.toHaveBeenCalled()
  })

  it('stops passing messages once the handler is removed', () => {
    openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
    const handler = vi.fn()
    setCanvasMessageHandler('a', handler)
    setCanvasMessageHandler('a', null)
    log(webviewOf('a').webview, 'dreamcoder-canvas:{"type":"open","id":"home"}', SCRIPT)
    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores the message a canvas sends to say which artifact it is when a handler is set', () => {
    openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
    const handler = vi.fn()
    setCanvasMessageHandler('a', handler)
    artifactApiMocks.list.mockResolvedValue({ artifacts: [] })
    log(webviewOf('a').webview, 'dreamcoder-canvas:{"type":"ready","artifact":"canvas-1"}', SCRIPT)
    expect(handler).not.toHaveBeenCalled()
  })

  describe('the color scheme of an artifact shell', () => {
    const attach = (tabId: string, url: string) => {
      const execute = vi.fn(async (_code: string) => undefined)
      const webview = makeReady(tabId, { url, execute })
      return { webview, execute }
    }
    const schemes = (execute: { mock: { calls: unknown[][] } }) => execute.mock.calls.map((call) => String(call[0]))

    afterEach(() => {
      useUIStore.setState({ theme: 'light' })
    })

    it('sets the scheme of the app theme when a project page is ready, on whichever shell the page has, and again for every later load', () => {
      useUIStore.setState({ theme: 'midnight' })
      openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
      const { webview, execute } = attach('a', 'dreamcoder-project://abc/flow/index.html')
      expect(schemes(execute)).toEqual(['(window.__dreamcoderCanvas || window.__dreamcoderDeck)?.setScheme("dark")'])
      webview.dispatchEvent(new Event('dom-ready'))
      expect(execute).toHaveBeenCalledTimes(2)
    })

    it('uses light for a light theme', () => {
      openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
      const { execute } = attach('a', 'dreamcoder-project://abc/flow/index.html')
      expect(schemes(execute)).toEqual([expect.stringContaining('setScheme("light")')])
    })

    it('does not run anything in pages that are not project pages', () => {
      useUIStore.setState({ theme: 'dark' })
      openBrowserUrl('s', 'a', 'https://example.com/')
      const { execute } = attach('a', 'https://example.com/')
      expect(execute).not.toHaveBeenCalled()
    })

    it('updates every ready project page when the theme changes and leaves other tabs alone', () => {
      openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
      openBrowserUrl('s', 'b', 'https://example.com/')
      const canvas = attach('a', 'dreamcoder-project://abc/flow/index.html')
      const other = attach('b', 'https://example.com/')
      canvas.execute.mockClear()
      useUIStore.getState().setTheme('aurora')
      expect(schemes(canvas.execute)).toEqual([expect.stringContaining('setScheme("dark")')])
      useUIStore.getState().setTheme('light')
      expect(schemes(canvas.execute)).toHaveLength(2)
      expect(schemes(canvas.execute)[1]).toContain('setScheme("light")')
      expect(other.execute).not.toHaveBeenCalled()
    })

    it('does nothing when something other than the theme changes', () => {
      openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
      const { execute } = attach('a', 'dreamcoder-project://abc/flow/index.html')
      execute.mockClear()
      useUIStore.setState({ sidebarOpen: false })
      expect(execute).not.toHaveBeenCalled()
    })
  })

  it('asks the shell of a ready page to refresh and reports when it cannot', async () => {
    openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
    expect(await refreshArtifactShell('a')).toBe(false)
    const webview = makeReady('a')
    const execute = vi.fn(async (_code: string) => undefined)
    Object.assign(webview, { executeJavaScript: execute })
    expect(await refreshArtifactShell('a')).toBe(true)
    expect(execute).toHaveBeenCalledWith('(window.__dreamcoderCanvas || window.__dreamcoderDeck) ? (window.__dreamcoderCanvas || window.__dreamcoderDeck).refresh() : false')
  })

  it('reports false and logs when the page cannot be asked, so the caller reloads it instead', async () => {
    openBrowserUrl('s', 'a', 'dreamcoder-project://abc/report/index.html')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    Object.assign(makeReady('a'), { executeJavaScript: vi.fn(async () => { throw new Error('navigating') }) })
    expect(await refreshArtifactShell('a')).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('reports false when the page has no shell to refresh', async () => {
    openBrowserUrl('s', 'a', 'dreamcoder-project://abc/report/index.html')
    const webview = makeReady('a')
    Object.assign(webview, { executeJavaScript: vi.fn(async (_code: string) => false) })
    expect(await refreshArtifactShell('a')).toBe(false)
  })

  describe('the board of a selection', () => {
    function readyCanvas(boardTitle: string | null | Error) {
      openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
      const webview = makeReady('a', { url: 'dreamcoder-project://abc/flow/index.html' })
      const execute = vi.fn(async (_code: string) => {
        if (boardTitle instanceof Error) throw boardTitle
        return boardTitle
      })
      Object.assign(webview, { executeJavaScript: execute })
      return execute
    }

    it('names the artifact and the board a selection came from', async () => {
      const execute = readyCanvas('Home')
      expect(await artifactReferenceLabel('a', 'dreamcoder-project://abc/flow/home.html')).toEqual({ name: 'flow / Home' })
      expect(execute.mock.calls[0]![0]).toContain('boardTitle("dreamcoder-project://abc/flow/home.html")')
    })

    it('gives a text selection in a board that name in the chat and keeps the title of its page', async () => {
      readyCanvas('Home')
      await addBrowserSelectionToChat({ guestId: 11, text: 'hello', truncated: false, title: 'Home page', url: 'dreamcoder-project://abc/flow/home.html' })
      const reference = useWorkspaceChatContextStore.getState().referencesBySession.s?.at(-1)
      expect(reference?.name).toBe('flow / Home')
      expect(reference?.browser?.title).toBe('Home page')
    })

    it('says nothing when the page is not a project page, the url is not a board or the page cannot answer', async () => {
      openBrowserUrl('s', 'a', 'https://example.com/')
      const execute = vi.fn(async () => 'Home')
      makeReady('a', { url: 'https://example.com/', execute })
      expect(await artifactReferenceLabel('a', 'https://example.com/x')).toBeNull()
      expect(execute).not.toHaveBeenCalled()
      closeBrowser('a')
      readyCanvas(null)
      expect(await artifactReferenceLabel('a', 'dreamcoder-project://abc/flow/other.html')).toBeNull()
      closeBrowser('a')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      readyCanvas(new Error('gone'))
      expect(await artifactReferenceLabel('a', 'dreamcoder-project://abc/flow/home.html')).toBeNull()
      expect(warn).toHaveBeenCalled()
    })
  })
})

describe('deck pages', () => {
  const PAGE = 'dreamcoder-project://abc/talk/index.html'
  const SCRIPT = 'dreamcoder-project://abc/__dreamcoder__/deck.js'
  const state = (overrides: Record<string, unknown> = {}) => ({ type: 'state', artifact: 'deck-1', slide: 'agenda', title: 'Agenda', index: 1, count: 3, mode: 'browse', ...overrides })
  const log = (webview: HTMLElement, payload: unknown, sourceId = SCRIPT) =>
    webview.dispatchEvent(Object.assign(new Event('console-message'), { message: `dreamcoder-deck:${JSON.stringify(payload)}`, sourceId }))
  const deckOf = (tabId: string) => useBrowserStore.getState().pageByTab[tabId]?.deck
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  function openDeck(tabId = 'a', sessionId: string | null = 's') {
    openBrowserUrl(sessionId, tabId, PAGE)
    const execute = vi.fn(async (_code: string): Promise<unknown> => undefined)
    const webview = makeReady(tabId, { url: `${PAGE}#agenda`, execute })
    execute.mockClear()
    return { webview, execute }
  }

  beforeEach(() => {
    artifactApiMocks.list.mockResolvedValue({ artifacts: [] })
  })

  describe('the state of the deck', () => {
    it('keeps what the deck script reports for the tab, whoever opened it', () => {
      const { webview } = openDeck()
      log(webview, state())
      expect(deckOf('a')).toEqual({ artifact: 'deck-1', slide: 'agenda', title: 'Agenda', index: 1, count: 3, mode: 'browse' })
      log(webview, state({ slide: 'numbers', title: 'numbers', index: 2, mode: 'overview' }))
      expect(deckOf('a')).toMatchObject({ slide: 'numbers', index: 2, mode: 'overview' })
    })

    it('ignores a state that another script logged or that is not a state', () => {
      const { webview } = openDeck()
      log(webview, state(), 'dreamcoder-project://abc/talk/embeds/demo.html')
      log(webview, state(), 'https://example.com/__dreamcoder__/deck.js')
      log(webview, state({ mode: 'edit' }))
      log(webview, state({ index: 3 }))
      expect(deckOf('a')).toBeNull()
    })

    it('forgets the deck when the tab goes to another page, and not when the deck only changes its address', () => {
      const { webview } = openDeck()
      log(webview, state())
      webview.dispatchEvent(Object.assign(new Event('did-navigate-in-page'), { url: `${PAGE}#numbers` }))
      expect(deckOf('a')).not.toBeNull()
      webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'https://example.com/' }))
      expect(deckOf('a')).toBeNull()
    })
  })

  describe('recognising the artifact of a tab', () => {
    const item = (overrides: Record<string, unknown> = {}) => ({
      id: 'deck-1',
      name: 'talk',
      artifactsDir: '/repo/dc_artifacts',
      workDir: '/repo',
      latestMtimeMs: 42,
      manifest: { version: 1, id: 'deck-1', kind: 'deck', title: 'Talk', entry: 'index.html' },
      ...overrides,
    })

    beforeEach(() => {
      artifactApiMocks.list.mockResolvedValue({ artifacts: [item()] })
      artifactApiMocks.open.mockResolvedValue({ rootDir: '/repo/dc_artifacts', filePath: '/repo/dc_artifacts/talk/index.html' })
      shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: PAGE })
    })

    it('gives a tab the agent opened the root and the artifact of the deck it shows, once the address is confirmed to be its entry', async () => {
      const { webview } = openDeck()
      log(webview, state())
      await flush()

      expect(artifactApiMocks.open).toHaveBeenCalledWith('/repo/dc_artifacts', 'talk')
      expect(shellMocks.resolveBrowserInput).toHaveBeenCalledWith(expect.objectContaining({ input: '/repo/dc_artifacts/talk/index.html', projectRoot: '/repo/dc_artifacts' }))
      expect(browserTab('a')).toMatchObject({ root: '/repo/dc_artifacts', artifact: { id: 'deck-1', name: 'talk', mtimeMs: 42, deck: true } })
    })

    it('does the same for a canvas that says which artifact it is', async () => {
      artifactApiMocks.list.mockResolvedValue({ artifacts: [item({ id: 'canvas-1', name: 'flow', workDir: null, manifest: { version: 1, id: 'canvas-1', kind: 'canvas', title: 'Flow', entry: 'index.html' } })] })
      shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: 'dreamcoder-project://abc/flow/index.html' })
      openBrowserUrl('s', 'a', 'dreamcoder-project://abc/flow/index.html')
      const webview = makeReady('a', { url: 'dreamcoder-project://abc/flow/index.html' })
      webview.dispatchEvent(Object.assign(new Event('console-message'), { message: 'dreamcoder-canvas:{"type":"ready","artifact":"canvas-1"}', sourceId: 'dreamcoder-project://abc/__dreamcoder__/canvas.js' }))
      await flush()

      expect(artifactApiMocks.open).toHaveBeenCalledWith('global', 'flow')
      expect(browserTab('a')).toMatchObject({ root: 'global', artifact: { id: 'canvas-1', name: 'flow', canvas: true } })
    })

    it('checks once for a deck, not again on every page turn', async () => {
      artifactApiMocks.list.mockResolvedValue({ artifacts: [] })
      const { webview } = openDeck()
      log(webview, state())
      log(webview, state({ slide: 'numbers', title: 'numbers', index: 2 }))
      await flush()
      expect(artifactApiMocks.list).toHaveBeenCalledOnce()

      webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: PAGE }))
      log(webview, state())
      await flush()
      expect(artifactApiMocks.list).toHaveBeenCalledTimes(2)
    })

    it('does not believe the id a page reports when the address of the tab is not the entry of that artifact', async () => {
      shellMocks.resolveBrowserInput.mockResolvedValue({ ok: true, url: 'dreamcoder-project://abc/real-talk/index.html' })
      const { webview } = openDeck()
      log(webview, state())
      await flush()
      expect(browserTab('a')).not.toHaveProperty('artifact')
      expect(browserTab('a')).not.toHaveProperty('root')
    })

    it('leaves a deck that is not a registered artifact, such as a template preview, with its controls only', async () => {
      artifactApiMocks.list.mockResolvedValue({ artifacts: [] })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { webview } = openDeck()
      log(webview, state({ artifact: 'template-deck' }))
      await flush()
      expect(deckOf('a')).not.toBeNull()
      expect(browserTab('a')).not.toHaveProperty('artifact')
      expect(artifactApiMocks.open).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('asks nothing for a tab that already has its artifact, a template preview or a page outside a chat', async () => {
      useWorkspacePanelStore.getState().patchTab('s', 'a', { root: '/repo/dc_artifacts', artifact: { id: 'deck-1', name: 'talk', mtimeMs: 1, deck: true } })
      log(openDeck('a').webview, state())
      log(openDeck('viewer', null).webview, state())
      await flush()
      expect(artifactApiMocks.list).not.toHaveBeenCalled()
      expect(browserTab('a')).toMatchObject({ artifact: { mtimeMs: 1 } })
      closeBrowser('viewer')
    })

    it('does not give the tab an artifact when the tab left the page while it was being checked', async () => {
      const { webview } = openDeck()
      log(webview, state())
      Object.assign(webview, { getURL: vi.fn(() => 'https://example.com/') })
      await flush()
      expect(browserTab('a')).not.toHaveProperty('artifact')
    })
  })

  describe('presenting', () => {
    let fullscreenElement: Element | null

    beforeEach(() => {
      fullscreenElement = null
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: vi.fn(async () => {
          fullscreenElement = null
          document.dispatchEvent(new Event('fullscreenchange'))
        }),
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(document, 'fullscreenElement')
      Reflect.deleteProperty(document, 'exitFullscreen')
    })

    function fullscreenSlot(tabId: string) {
      const { slot } = webviewOf(tabId)
      slot.requestFullscreen = vi.fn(async () => {
        fullscreenElement = slot
        document.dispatchEvent(new Event('fullscreenchange'))
      })
      return slot
    }

    it('makes the slot that holds the page full screen, gives the page the keyboard and then starts the presentation', async () => {
      const { webview, execute } = openDeck()
      const slot = fullscreenSlot('a')
      await presentDeck('a')

      expect(slot.requestFullscreen).toHaveBeenCalledOnce()
      expect(webview.focus).toHaveBeenCalledOnce()
      expect(execute.mock.calls.map((call) => call[0])).toEqual(['window.__dreamcoderDeck?.setMode("present")'])
    })

    it('leaves full screen when the page asks to leave the presentation, and then returns the deck to browse mode', async () => {
      const { webview, execute } = openDeck()
      fullscreenSlot('a')
      await presentDeck('a')
      log(webview, state({ mode: 'present' }))
      execute.mockClear()

      log(webview, { type: 'exit' })
      expect(document.exitFullscreen).toHaveBeenCalledOnce()
      expect(execute.mock.calls.map((call) => call[0])).toEqual(['window.__dreamcoderDeck?.setMode("browse")'])
    })

    it('returns the deck to browse mode when the system ends full screen', async () => {
      const { webview, execute } = openDeck()
      fullscreenSlot('a')
      await presentDeck('a')
      log(webview, state({ mode: 'present' }))
      execute.mockClear()

      fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
      expect(execute.mock.calls.map((call) => call[0])).toEqual(['window.__dreamcoderDeck?.setMode("browse")'])
    })

    it('returns a deck that presents without full screen to browse mode when the page asks to leave', () => {
      const { webview, execute } = openDeck()
      log(webview, { type: 'exit' })
      expect(document.exitFullscreen).not.toHaveBeenCalled()
      expect(execute.mock.calls.map((call) => call[0])).toEqual(['window.__dreamcoderDeck?.setMode("browse")'])
    })
  })

  describe('references to a slide', () => {
    it('names the artifact and the current slide, and puts the file of the slide in the title the agent reads', async () => {
      const { webview, execute } = openDeck()
      log(webview, state())
      expect(await artifactReferenceLabel('a', `${PAGE}#agenda`)).toEqual({ name: 'talk / Agenda', title: 'slides/agenda.html · Agenda' })
      expect(execute).not.toHaveBeenCalled()
    })

    it('gives a text selection on a slide, or inside a page embedded in it, that name and title', async () => {
      const { webview } = openDeck()
      log(webview, state())
      await addBrowserSelectionToChat({ guestId: 11, text: 'hello', truncated: false, title: 'Demo', url: 'dreamcoder-project://abc/talk/embeds/demo.html' })
      const reference = useWorkspaceChatContextStore.getState().referencesBySession.s?.at(-1)
      expect(reference?.name).toBe('talk / Agenda')
      expect(reference?.browser?.title).toBe('slides/agenda.html · Agenda')
    })
  })

  it('reads the place of the current slide from the deck and refuses anything that is not a rectangle', async () => {
    const { execute } = openDeck()
    execute.mockResolvedValueOnce({ x: 24, y: 114, width: 960, height: 540 })
    expect(await deckStageRect('a')).toEqual({ x: 24, y: 114, width: 960, height: 540 })
    execute.mockResolvedValueOnce({ x: 0, y: 0, width: 0, height: 0 })
    expect(await deckStageRect('a')).toBeNull()
    execute.mockResolvedValueOnce(null)
    expect(await deckStageRect('a')).toBeNull()
    expect(await deckStageRect('missing')).toBeNull()
  })

  it('gives the size the page is shown at', () => {
    openDeck()
    expect(browserGuestSize('a')).toBeNull()
    placeBrowserGuest('a', stageAt(10, 20, 640.4, 480), true)
    webviewOf('a').slot.getBoundingClientRect = () => rect(10, 20, 640.4, 479.6)
    expect(browserGuestSize('a')).toEqual({ width: 640, height: 480 })
  })
})
