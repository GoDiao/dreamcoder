import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import canvasSource from '../../public/canvas-shell/canvas.js?raw'

type Board = { id: string; file: string; title?: string; x: number; y: number; width: number; height: number }
type Shell = { refresh: () => Promise<void>; view: () => { x: number; y: number; scale: number }; setScheme: (scheme: unknown) => void }

const PREFIX = 'dreamcoder-canvas:'

let manifest: { boards: Board[] } | null
let files: Set<string>
let fetched: string[]
let logs: unknown[]

const board = (id: string, overrides: Partial<Board> = {}): Board => ({ id, file: `${id}.html`, x: 0, y: 0, width: 400, height: 300, ...overrides })

function shell() {
  return (window as unknown as { __dreamcoderCanvas: Shell }).__dreamcoderCanvas
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function start() {
  new Function(canvasSource)()
  await settle()
}

function pointer(type: string, target: EventTarget, clientX: number, clientY: number) {
  target.dispatchEvent(new MouseEvent(type, { clientX, clientY, button: 0, bubbles: true, cancelable: true }))
}

const pageArea = (id: string) => element(id).querySelector('.board-bar')!.nextElementSibling as HTMLElement
const interactButton = (id: string) => element(id).querySelector('.board-interact') as HTMLElement
const openButton = (id: string) => element(id).querySelector('.board-open:not(.board-interact)') as HTMLElement

const messages = () => logs.map((entry) => JSON.parse(String(entry).slice(PREFIX.length)) as Record<string, unknown>)
const element = (id: string) => document.querySelector(`[data-board="${id}"]`) as HTMLElement

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  manifest = { boards: [board('home'), board('detail', { x: 500, title: 'Detail screen' })] }
  files = new Set(['home.html', 'detail.html'])
  fetched = []
  logs = []
  vi.spyOn(console, 'log').mockImplementation((entry: unknown) => {
    if (String(entry).startsWith(PREFIX)) logs.push(entry)
  })
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input)
    fetched.push(url.pathname)
    if (url.pathname.endsWith('/artifact.json')) {
      return manifest ? new Response(JSON.stringify(manifest)) : new Response('', { status: 404 })
    }
    return files.has(url.pathname.split('/').pop() ?? '') ? new Response('<p>x</p>') : new Response('', { status: 404 })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as unknown as { __dreamcoderCanvas?: Shell }).__dreamcoderCanvas
})

describe('canvas shell boards', () => {
  it('puts every board in a same-origin iframe titled with the board title or id', async () => {
    await start()
    const frames = [...document.querySelectorAll('iframe')]
    expect(frames.map((frame) => frame.title)).toEqual(['home', 'Detail screen'])
    expect(frames.map((frame) => new URL(frame.src).pathname)).toEqual(['/home.html', '/detail.html'])
    expect(element('detail').style.left).toBe('500px')
    expect(element('home').style.width).toBe('400px')
  })

  it('shows a placeholder with the file name for a board file that does not exist', async () => {
    files.delete('detail.html')
    await start()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(element('detail').textContent).toContain('detail.html')
    expect(element('detail').textContent).toContain('File not found')
  })

  it('refuses absolute paths, protocols and parent folders without fetching them', async () => {
    manifest = { boards: [board('a', { file: '/etc/passwd' }), board('b', { file: 'https://example.com/x.html' }), board('c', { file: '../other/c.html' }), board('d', { file: 'data:text/html,x' })] }
    await start()
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(['a', 'b', 'c', 'd'].every((id) => element(id).textContent?.includes('Not a file inside this canvas'))).toBe(true)
    expect(fetched.filter((path) => !path.endsWith('/artifact.json'))).toEqual([])
  })

  it('says so when the canvas has no boards', async () => {
    manifest = { boards: [] }
    await start()
    expect(document.getElementById('notice')?.textContent).toBe('This canvas has no boards yet')
  })

  it('says so when the manifest cannot be read', async () => {
    manifest = null
    await start()
    expect(document.getElementById('notice')?.textContent).toBe('Could not read the canvas')
  })

  it('ignores boards without a numeric position', async () => {
    manifest = { boards: [board('good'), { id: 'bad', file: 'bad.html' } as unknown as Board] }
    await start()
    expect(element('good')).not.toBeNull()
    expect(element('bad')).toBeNull()
  })
})

describe('canvas shell messages', () => {
  it('reports a moved board once, after the drag ends, in canvas units', async () => {
    await start()
    const scale = shell().view().scale
    const bar = element('home').querySelector('.board-bar')!
    pointer('pointerdown', bar, 100, 100)
    pointer('pointermove', document, 160, 140)
    expect(messages()).toEqual([])
    pointer('pointerup', document, 160, 140)
    const [moved] = messages()
    expect(moved).toMatchObject({ type: 'move', id: 'home', width: 400, height: 300 })
    expect(moved!.x).toBe(Math.round(60 / scale))
    expect(moved!.y).toBe(Math.round(40 / scale))
    expect(element('home').style.left).toBe(`${moved!.x}px`)
  })

  it('rounds position and size before they are reported and shown', async () => {
    manifest = { boards: [board('home', { width: 1400 }), board('detail', { x: 1500 })] }
    await start()
    const scale = shell().view().scale
    expect(scale).not.toBe(1)
    pointer('pointerdown', element('home').querySelector('.board-bar')!, 0, 0)
    pointer('pointermove', document, 33.3, 17.7)
    pointer('pointerup', document, 33.3, 17.7)
    pointer('pointerdown', element('detail').querySelector('.board-resize')!, 0, 0)
    pointer('pointermove', document, 21.9, 13.1)
    pointer('pointerup', document, 21.9, 13.1)
    const [moved, resized] = messages()
    for (const value of [moved!.x, moved!.y, moved!.width, moved!.height, resized!.x, resized!.y, resized!.width, resized!.height]) {
      expect(Number.isInteger(value)).toBe(true)
    }
    expect(element('home').style.left).toBe(`${moved!.x}px`)
    expect(element('detail').style.width).toBe(`${resized!.width}px`)
  })

  it('reports nothing when a drag moves less than half a pixel and rounds back to the start', async () => {
    await start()
    pointer('pointerdown', element('home').querySelector('.board-bar')!, 100, 100)
    pointer('pointermove', document, 100.2, 100.2)
    pointer('pointerup', document, 100.2, 100.2)
    expect(messages()).toEqual([])
  })

  it('reports nothing when a drag ends where it started', async () => {
    await start()
    const bar = element('home').querySelector('.board-bar')!
    pointer('pointerdown', bar, 100, 100)
    pointer('pointerup', document, 100, 100)
    expect(messages()).toEqual([])
  })

  it('reports a resized board and keeps a minimum size', async () => {
    await start()
    const handle = element('home').querySelector('.board-resize')!
    pointer('pointerdown', handle, 0, 0)
    pointer('pointermove', document, -100000, -100000)
    pointer('pointerup', document, -100000, -100000)
    expect(messages()).toEqual([expect.objectContaining({ type: 'move', id: 'home', x: 0, y: 0, width: 120, height: 120 })])
  })

  it('does not start a drag from the open button and reports open for the board', async () => {
    await start()
    const open = openButton('detail') as HTMLButtonElement
    pointer('pointerdown', open, 5, 5)
    pointer('pointerup', document, 5, 5)
    open.click()
    expect(messages()).toEqual([{ type: 'open', id: 'detail' }])
  })

  it('stops pointer-driven moves from reaching the board pages while dragging', async () => {
    await start()
    pointer('pointerdown', element('home').querySelector('.board-bar')!, 1, 1)
    expect(document.body.classList.contains('dragging')).toBe(true)
    pointer('pointerup', document, 1, 1)
    expect(document.body.classList.contains('dragging')).toBe(false)
  })
})

describe('canvas shell view', () => {
  it('zooms around the pointer on ctrl+wheel and keeps the page from scrolling', async () => {
    await start()
    const before = shell().view()
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: 200, clientY: 150, bubbles: true, cancelable: true })
    document.getElementById('viewport')!.dispatchEvent(event)
    const after = shell().view()
    expect(event.defaultPrevented).toBe(true)
    expect(after.scale).toBeGreaterThan(before.scale)
    const worldX = (200 - before.x) / before.scale
    expect((200 - after.x) / after.scale).toBeCloseTo(worldX, 5)
  })

  it('limits the zoom', async () => {
    await start()
    for (let index = 0; index < 60; index += 1) {
      document.getElementById('viewport')!.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -500, bubbles: true, cancelable: true }))
    }
    expect(shell().view().scale).toBe(4)
    for (let index = 0; index < 120; index += 1) {
      document.getElementById('viewport')!.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 500, bubbles: true, cancelable: true }))
    }
    expect(shell().view().scale).toBe(0.1)
  })

  it('pans on a plain wheel and by dragging the background', async () => {
    await start()
    const before = shell().view()
    const wheel = new WheelEvent('wheel', { deltaX: 10, deltaY: 20, bubbles: true, cancelable: true })
    document.getElementById('viewport')!.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(shell().view()).toMatchObject({ x: before.x - 10, y: before.y - 20 })
    pointer('pointerdown', document.getElementById('viewport')!, 0, 0)
    pointer('pointermove', document, 30, 40)
    pointer('pointerup', document, 30, 40)
    expect(shell().view()).toMatchObject({ x: before.x - 10 + 30, y: before.y - 20 + 40 })
  })

  it('marks the viewport as panning from the pointer down on the background until the pointer is released', async () => {
    await start()
    const viewport = document.getElementById('viewport')!
    expect(viewport.classList.contains('panning')).toBe(false)
    pointer('pointerdown', viewport, 0, 0)
    expect(viewport.classList.contains('panning')).toBe(true)
    pointer('pointerup', document, 0, 0)
    expect(viewport.classList.contains('panning')).toBe(false)
  })

  it('pans when the pointer goes down on the page area of a board', async () => {
    await start()
    const before = shell().view()
    pointer('pointerdown', pageArea('home'), 0, 0)
    pointer('pointermove', document, 30, 40)
    pointer('pointerup', document, 30, 40)
    expect(shell().view()).toMatchObject({ x: before.x + 30, y: before.y + 40 })
  })

  it('does not pan from the buttons in a board title bar', async () => {
    await start()
    const before = shell().view()
    for (const button of [interactButton('home'), openButton('home')]) {
      pointer('pointerdown', button, 0, 0)
      pointer('pointermove', document, 30, 40)
      pointer('pointerup', document, 30, 40)
    }
    expect(shell().view()).toEqual(before)
  })

  it('does not pan when a board is dragged', async () => {
    await start()
    const before = shell().view()
    pointer('pointerdown', element('home').querySelector('.board-bar')!, 0, 0)
    pointer('pointermove', document, 50, 50)
    pointer('pointerup', document, 50, 50)
    expect(shell().view()).toEqual(before)
  })
})

describe('canvas shell interaction mode', () => {
  it('keeps board pages from taking pointer events until a board is in interaction mode', async () => {
    await start()
    const css = document.querySelector('style')!.textContent!
    expect(css).toMatch(/\.board-frame\{[^}]*pointer-events:none/)
    expect(css).toContain('.board.interactive .board-frame{pointer-events:auto}')
    expect(css).toContain('.dragging .board.interactive .board-frame,#viewport.panning .board.interactive .board-frame{pointer-events:none}')
  })

  it('does not let a double click select the boards or their pages in the canvas document', async () => {
    await start()
    const css = document.querySelector('style')!.textContent!
    expect(css).toMatch(/#viewport\{[^}]*user-select:none/)
  })

  it('enters interaction mode from the button in the title bar and leaves from the same button', async () => {
    await start()
    expect(interactButton('home').textContent).toBe('Interact')
    expect(interactButton('home').getAttribute('aria-label')).toBe('Interact: home')
    expect(interactButton('detail').getAttribute('aria-label')).toBe('Interact: Detail screen')
    interactButton('home').click()
    expect(element('home').classList.contains('interactive')).toBe(true)
    expect(interactButton('home').textContent).toBe('Stop interacting')
    expect(interactButton('home').getAttribute('aria-pressed')).toBe('true')
    interactButton('home').click()
    expect(element('home').classList.contains('interactive')).toBe(false)
    expect(interactButton('home').textContent).toBe('Interact')
    expect(interactButton('home').getAttribute('aria-pressed')).toBe('false')
  })

  it('has one board in interaction mode at a time', async () => {
    await start()
    interactButton('home').click()
    pointer('pointerdown', interactButton('detail'), 0, 0)
    interactButton('detail').click()
    expect(element('home').classList.contains('interactive')).toBe(false)
    expect(element('detail').classList.contains('interactive')).toBe(true)
    expect(interactButton('home').textContent).toBe('Interact')
  })

  it('enters interaction mode on a double click on the page area, not on the title bar or the background', async () => {
    await start()
    element('home').querySelector('.board-bar')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    document.getElementById('viewport')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(document.querySelector('.interactive')).toBeNull()
    pageArea('home').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(element('home').classList.contains('interactive')).toBe(true)
  })

  it('leaves interaction mode when the pointer goes down outside the board and not inside it', async () => {
    await start()
    interactButton('home').click()
    pointer('pointerdown', element('home').querySelector('.board-bar')!, 0, 0)
    pointer('pointerup', document, 0, 0)
    expect(element('home').classList.contains('interactive')).toBe(true)
    pointer('pointerdown', document.getElementById('viewport')!, 0, 0)
    pointer('pointerup', document, 0, 0)
    expect(element('home').classList.contains('interactive')).toBe(false)
  })

  it('leaves interaction mode when another board title bar or resize handle is pressed', async () => {
    await start()
    for (const selector of ['.board-bar', '.board-resize']) {
      interactButton('home').click()
      expect(element('home').classList.contains('interactive')).toBe(true)
      pointer('pointerdown', element('detail').querySelector(selector)!, 0, 0)
      pointer('pointerup', document, 0, 0)
      expect(element('home').classList.contains('interactive')).toBe(false)
    }
  })

  it('moves the keyboard focus into the board page on entering and back to the button on leaving', async () => {
    await start()
    interactButton('home').click()
    const frame = element('home').querySelector('iframe')!
    expect(document.activeElement).toBe(frame)
    frame.dispatchEvent(new Event('load'))
    frame.contentDocument!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.activeElement).toBe(interactButton('home'))
  })

  it('leaves interaction mode on Escape from the canvas and from inside the board page', async () => {
    await start()
    interactButton('home').click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(element('home').classList.contains('interactive')).toBe(false)
    interactButton('home').click()
    const frame = element('home').querySelector('iframe')!
    frame.dispatchEvent(new Event('load'))
    frame.contentDocument!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(element('home').classList.contains('interactive')).toBe(false)
  })

  it('ignores other keys', async () => {
    await start()
    interactButton('home').click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(element('home').classList.contains('interactive')).toBe(true)
  })

  it('names the button in the language of the page', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN')
    await start()
    expect(interactButton('home').textContent).toBe('交互')
    expect(interactButton('home').getAttribute('aria-label')).toBe('交互: home')
    interactButton('home').click()
    expect(interactButton('home').textContent).toBe('退出交互')
  })
})

const click = (id: string) => (document.getElementById(id) as HTMLElement).click()
const percentText = () => document.getElementById('zoom-percent')!.textContent
const menuItem = (value: number) => document.querySelector(`#zoom-menu [data-zoom="${value}"]`) as HTMLElement

describe('canvas shell toolbar', () => {
  it('shows the zoom percentage and keeps it current for buttons and wheel', async () => {
    await start()
    expect(percentText()).toBe(`${Math.round(shell().view().scale * 100)}%`)
    click('zoom-in')
    expect(percentText()).toBe(`${Math.round(shell().view().scale * 100)}%`)
    document.getElementById('viewport')!.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true }))
    expect(percentText()).toBe(`${Math.round(shell().view().scale * 100)}%`)
  })

  it('zooms in and out around the center of the viewport', async () => {
    await start()
    const before = shell().view()
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    click('zoom-in')
    const bigger = shell().view()
    expect(bigger.scale).toBeGreaterThan(before.scale)
    expect((cx - bigger.x) / bigger.scale).toBeCloseTo((cx - before.x) / before.scale, 5)
    expect((cy - bigger.y) / bigger.scale).toBeCloseTo((cy - before.y) / before.scale, 5)
    click('zoom-out')
    expect(shell().view().scale).toBeCloseTo(before.scale, 5)
  })

  it('stops at the zoom limits', async () => {
    await start()
    for (let index = 0; index < 40; index += 1) click('zoom-in')
    expect(shell().view().scale).toBe(4)
    expect(percentText()).toBe('400%')
    for (let index = 0; index < 40; index += 1) click('zoom-out')
    expect(shell().view().scale).toBe(0.1)
    expect(percentText()).toBe('10%')
  })

  it('opens a menu with the presets and zooms to the chosen one', async () => {
    await start()
    const menu = document.getElementById('zoom-menu') as HTMLElement
    expect(menu.hidden).toBe(true)
    click('zoom-percent')
    expect(menu.hidden).toBe(false)
    expect([...menu.querySelectorAll('[data-zoom]')].map((item) => item.textContent)).toEqual(['25%', '50%', '75%', '100%', '150%', '200%'])
    menuItem(2).click()
    expect(shell().view().scale).toBeCloseTo(2, 5)
    expect(percentText()).toBe('200%')
    expect(menu.hidden).toBe(true)
    click('zoom-percent')
    menuItem(0.25).click()
    expect(percentText()).toBe('25%')
    expect(menuItem(0.25).className).toBe('current')
    expect(menuItem(2).className).toBe('')
  })

  it('fits all boards from the menu', async () => {
    await start()
    const fitted = shell().view()
    click('zoom-in')
    click('zoom-in')
    expect(shell().view()).not.toEqual(fitted)
    click('zoom-percent')
    click('zoom-fit')
    expect(shell().view().scale).toBeCloseTo(fitted.scale, 5)
    expect(shell().view().x).toBeCloseTo(fitted.x, 5)
    expect(shell().view().y).toBeCloseTo(fitted.y, 5)
    expect((document.getElementById('zoom-menu') as HTMLElement).hidden).toBe(true)
  })

  it('closes the menu when the pointer goes down elsewhere', async () => {
    await start()
    click('zoom-percent')
    pointer('pointerdown', document.getElementById('viewport')!, 5, 5)
    expect((document.getElementById('zoom-menu') as HTMLElement).hidden).toBe(true)
  })

  it('does not pan or drag when the pointer is used on the toolbar', async () => {
    await start()
    const before = shell().view()
    pointer('pointerdown', document.getElementById('tools')!, 10, 10)
    pointer('pointermove', document, 80, 90)
    pointer('pointerup', document, 80, 90)
    pointer('pointerdown', document.getElementById('zoom-percent')!, 10, 10)
    pointer('pointermove', document, 80, 90)
    pointer('pointerup', document, 80, 90)
    expect(shell().view()).toEqual(before)
    expect(messages()).toEqual([])
  })

  it('names the controls in the language of the page', async () => {
    await start()
    expect(document.getElementById('zoom-in')!.getAttribute('aria-label')).toBe('Zoom in')
    expect(document.getElementById('zoom-fit')!.textContent).toBe('Fit all boards')
  })
})

describe('canvas shell color scheme', () => {
  const root = () => document.documentElement

  beforeEach(() => {
    root().removeAttribute('data-scheme')
    root().style.colorScheme = ''
  })

  it('has no media query and starts light', async () => {
    await start()
    expect(document.head.textContent).not.toContain('prefers-color-scheme')
    expect(root().getAttribute('data-scheme')).toBeNull()
    expect(document.head.textContent).toContain(':root[data-scheme=dark]')
  })

  it('sets the scheme on the root element and the color-scheme with it', async () => {
    await start()
    shell().setScheme('dark')
    expect(root().getAttribute('data-scheme')).toBe('dark')
    expect(root().style.colorScheme).toBe('dark')
    shell().setScheme('light')
    expect(root().getAttribute('data-scheme')).toBe('light')
    expect(root().style.colorScheme).toBe('light')
  })

  it('ignores any other value', async () => {
    await start()
    shell().setScheme('dark')
    for (const value of ['auto', '', 'Dark', null, undefined, 1, {}]) shell().setScheme(value)
    expect(root().getAttribute('data-scheme')).toBe('dark')
    expect(root().style.colorScheme).toBe('dark')
  })
})

describe('canvas shell refresh', () => {
  it('rereads the manifest, reloads every board and keeps the pan and zoom', async () => {
    await start()
    document.getElementById('viewport')!.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true }))
    const view = shell().view()
    const homeBefore = document.querySelector('iframe')!
    manifest = { boards: [board('home', { x: 40, y: 50 }), board('detail', { x: 500, title: 'Renamed' })] }

    await shell().refresh()

    expect(shell().view()).toEqual(view)
    expect(element('home').style.left).toBe('40px')
    expect(element('detail').querySelector('.board-title')?.textContent).toBe('Renamed')
    const homeAfter = element('home').querySelector('iframe')!
    expect(homeAfter).not.toBe(homeBefore)
    expect(homeAfter.src).toContain('?t=')
  })

  it('adds new boards and removes the ones that are gone', async () => {
    await start()
    files.add('new.html')
    manifest = { boards: [board('home'), board('new', { x: 900 })] }

    await shell().refresh()

    expect(element('detail')).toBeNull()
    expect(element('new').querySelector('iframe')?.title).toBe('new')
  })

  it('shows a placeholder when a board file was deleted', async () => {
    await start()
    files.delete('home.html')
    await shell().refresh()
    expect(element('home').textContent).toContain('home.html')
    expect(element('home').querySelector('iframe')).toBeNull()
  })

  it('does not drop the boards when the manifest cannot be read for a moment', async () => {
    await start()
    manifest = null
    await shell().refresh()
    expect(element('home')).not.toBeNull()
    expect(document.getElementById('notice')?.textContent).toBe('Could not read the canvas')
  })
})

describe('canvas shell board titles', () => {
  const titleOf = (url: string) => (window as unknown as { __dreamcoderCanvas: { boardTitle: (url: string) => string | null } }).__dreamcoderCanvas.boardTitle(url)

  it('names the board that owns a document, by its title or else its id', async () => {
    await start()
    expect(titleOf(`${location.origin}/home.html`)).toBe('home')
    expect(titleOf(`${location.origin}/detail.html?x=1`)).toBe('Detail screen')
  })

  it('knows nothing about other documents or addresses that cannot be read', async () => {
    await start()
    expect(titleOf(`${location.origin}/other.html`)).toBeNull()
    expect(titleOf('http://[bad')).toBeNull()
  })

  it('skips boards whose file is not allowed', async () => {
    manifest = { boards: [board('a', { file: '../x.html' })] }
    await start()
    expect(titleOf(`${location.origin}/x.html`)).toBeNull()
  })
})
