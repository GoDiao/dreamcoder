import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import deckSource from '../../public/artifact-shell/deck.js?raw'

type DeckState = { artifact: string | null; slide: string | null; title: string | null; index: number; count: number; mode: string }
type Overflow = Array<{ slide: string; elements: Array<{ element: string; text: string; left: number; top: number; right: number; bottom: number }> }>
type Shell = {
  state: () => DeckState
  goTo: (id: string) => boolean
  next: () => void
  prev: () => void
  setMode: (mode: string) => void
  setScheme: (scheme: unknown) => void
  refresh: () => Promise<boolean>
  stageRect: () => { x: number; y: number; width: number; height: number } | null
  overflow: () => Overflow
}

const PREFIX = 'dreamcoder-deck:'

let manifest: Record<string, unknown> | null
let files: Map<string, string>
let fetched: string[]
let tags: Map<string, string>
let asked: string[]
let logs: string[]
let listeners: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject }>

const section = (body: string) => `<section class="slide">${body}</section>\n`
const shell = () => (window as unknown as { __dreamcoderDeck: Shell }).__dreamcoderDeck
const messages = () => logs.map((entry) => JSON.parse(entry.slice(PREFIX.length)) as Record<string, unknown>)
const slide = (id: string) => document.querySelector(`.dc-slide[data-slide="${id}"]`) as HTMLElement
const shownSlides = () => [...document.querySelectorAll('.dc-slide[data-current]')].map((element) => element.getAttribute('data-slide'))
const order = () => [...document.querySelectorAll('.dc-slide')].map((element) => element.getAttribute('data-slide') ?? '')
const pending = () => [...document.querySelectorAll('[data-dc-pending]')].map((element) => element.textContent)
const deck = () => document.getElementById('dc-deck') as HTMLElement
const stageStyle = (name: string) => (document.querySelector('.dc-stage') as HTMLElement).style.getPropertyValue(name)

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function tracked(action: () => void) {
  const targets: EventTarget[] = [document, window]
  const spies = targets.map((target) => {
    const add = target.addEventListener.bind(target)
    return vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      listeners.push({ target, type, listener })
      add(type, listener, options)
    })
  })
  action()
  spies.forEach((spy) => spy.mockRestore())
}

const run = () => tracked(() => new Function(deckSource)())

async function start() {
  run()
  await settle()
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  document.body.dispatchEvent(event)
  return event
}

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.title = ''
  document.documentElement.removeAttribute('data-scheme')
  history.replaceState(null, '', '/talk/index.html')
  manifest = { version: 1, id: 'deck-1', kind: 'deck', title: 'Quarterly review', entry: 'index.html', slides: ['cover', 'agenda', 'numbers'] }
  files = new Map([
    ['/talk/deck.css', '.slide{padding:96px}'],
    ['/talk/slides/cover.html', section('<h1> Quarterly\n review </h1><p>2026</p>')],
    ['/talk/slides/agenda.html', section('<h2>Agenda</h2><ul><li class="fragment">One</li><li class="fragment">Two</li></ul>')],
    ['/talk/slides/numbers.html', section('<p>No heading here</p>')],
  ])
  fetched = []
  tags = new Map()
  asked = []
  logs = []
  listeners = []
  vi.spyOn(console, 'log').mockImplementation((entry: unknown) => {
    if (String(entry).startsWith(PREFIX)) logs.push(String(entry))
  })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    if (init?.method === 'HEAD') {
      asked.push(url.host === location.host ? url.pathname : url.href)
      const tag = tags.get(url.pathname)
      return tag === undefined ? new Response(null, { status: 404 }) : new Response(null, { headers: { etag: tag } })
    }
    fetched.push(url.pathname)
    if (url.pathname === '/talk/artifact.json') return manifest ? new Response(JSON.stringify(manifest)) : new Response('', { status: 404 })
    const body = files.get(url.pathname)
    return body === undefined ? new Response('', { status: 404 }) : new Response(body)
  })
})

afterEach(() => {
  for (const { target, type, listener } of listeners) target.removeEventListener(type, listener)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as unknown as { __dreamcoderDeck?: Shell }).__dreamcoderDeck
  history.replaceState(null, '', '/')
})

describe('deck shell rendering', () => {
  it('puts the section of every listed slide into its own wrapper in manifest order and shows the first one', async () => {
    await start()
    expect(order()).toEqual(['cover', 'agenda', 'numbers'])
    expect(slide('agenda').children).toHaveLength(1)
    expect(slide('agenda').firstElementChild?.tagName).toBe('SECTION')
    expect(slide('agenda').querySelector('li')?.textContent).toBe('One')
    expect(shownSlides()).toEqual(['cover'])
    expect(deck().getAttribute('data-mode')).toBe('browse')
    expect(document.title).toBe('Quarterly review')
  })

  it('reads the slides from the folder of the artifact, without caching', async () => {
    await start()
    expect(fetched.sort()).toEqual(['/talk/artifact.json', '/talk/deck.css', '/talk/slides/agenda.html', '/talk/slides/cover.html', '/talk/slides/numbers.html'])
  })

  it('links deck.css, and the tokens of the design system before it', async () => {
    manifest = { ...manifest, designSystem: 'systems/alpha' }
    files.set('/systems/alpha/tokens.css', ':root{--bg:#fff}')
    await start()
    const links = [...document.head.querySelectorAll('link[rel=stylesheet]')].map((link) => new URL((link as HTMLLinkElement).href).pathname)
    expect(links).toEqual(['/systems/alpha/tokens.css', '/talk/deck.css'])
  })

  it('shows a placeholder with the file path for a slide that is missing or is not one section, and keeps the others', async () => {
    files.delete('/talk/slides/agenda.html')
    files.set('/talk/slides/numbers.html', '<p>before</p><section>x</section>')
    await start()
    expect(slide('agenda').querySelector('.dc-missing')?.textContent).toContain('slides/agenda.html')
    expect(slide('numbers').querySelector('.dc-missing')?.textContent).toContain('slides/numbers.html')
    expect(slide('cover').querySelector('h1')).not.toBeNull()
  })

  it('leaves out ids that are not allowed or repeated, and never requests their files', async () => {
    manifest = { ...manifest, slides: ['cover', '../secret', 'cover', 7, 'agenda'] }
    await start()
    expect(order()).toEqual(['cover', 'agenda'])
    expect(fetched.some((path) => path.includes('secret'))).toBe(false)
  })

  it('says so when the deck has no slides or the manifest cannot be read', async () => {
    manifest = { ...manifest, slides: [] }
    await start()
    expect(document.querySelector('.dc-notice')?.textContent).toBe('This deck has no slides yet')
    expect(shell().state()).toMatchObject({ slide: null, index: -1, count: 0 })

    document.body.innerHTML = ''
    manifest = null
    await start()
    expect(document.querySelector('.dc-notice')?.textContent).toBe('Could not read the deck')
  })

  it('does not run a script that a slide file contains', async () => {
    files.set('/talk/slides/cover.html', section('<script>window.__ranFromSlide = true</script><h1>Cover</h1>'))
    await start()
    expect((window as unknown as { __ranFromSlide?: boolean }).__ranFromSlide).toBeUndefined()
  })

  it('scales the fixed 1920 by 1080 stage into the viewport with a margin, and to the full viewport when presenting', async () => {
    vi.stubGlobal('innerWidth', 1008)
    vi.stubGlobal('innerHeight', 768)
    await start()
    expect(Number(stageStyle('--dc-scale'))).toBeCloseTo(0.5)
    expect(stageStyle('--dc-x')).toBe('24px')
    expect(stageStyle('--dc-y')).toBe('114px')

    shell().setMode('present')
    expect(Number(stageStyle('--dc-scale'))).toBeCloseTo(0.525)
    expect(stageStyle('--dc-x')).toBe('0px')
  })

  it('sets the color scheme of the margin around the slide', async () => {
    await start()
    shell().setScheme('dark')
    expect(document.documentElement.getAttribute('data-scheme')).toBe('dark')
    shell().setScheme('sepia')
    expect(document.documentElement.getAttribute('data-scheme')).toBe('dark')
  })
})

describe('deck shell paging', () => {
  it('reports the artifact, the current slide with the text of its first heading, the position and the mode', async () => {
    await start()
    expect(messages()).toEqual([{ type: 'state', artifact: 'deck-1', slide: 'cover', title: 'Quarterly review', index: 0, count: 3, mode: 'browse' }])
    shell().goTo('numbers')
    expect(messages()[1]).toEqual({ type: 'state', artifact: 'deck-1', slide: 'numbers', title: 'numbers', index: 2, count: 3, mode: 'browse' })
  })

  it('turns pages with next, prev and goTo, stops at both ends and refuses an unknown slide', async () => {
    await start()
    shell().next()
    expect(shownSlides()).toEqual(['agenda'])
    shell().next()
    shell().next()
    expect(shownSlides()).toEqual(['numbers'])
    shell().prev()
    expect(shownSlides()).toEqual(['agenda'])
    expect(shell().goTo('nope')).toBe(false)
    expect(shownSlides()).toEqual(['agenda'])
    expect(shell().goTo('cover')).toBe(true)
    shell().prev()
    expect(shownSlides()).toEqual(['cover'])
  })

  it('keeps the current slide in the address and opens the slide the address names', async () => {
    await start()
    expect(location.hash).toBe('#cover')
    shell().next()
    expect(location.hash).toBe('#agenda')

    document.body.innerHTML = ''
    history.replaceState(null, '', '/talk/index.html#numbers')
    await start()
    expect(shownSlides()).toEqual(['numbers'])
  })

  it('falls back to the first slide when the address names a slide that does not exist', async () => {
    history.replaceState(null, '', '/talk/index.html#deleted')
    await start()
    expect(shownSlides()).toEqual(['cover'])
    expect(location.hash).toBe('#cover')
  })

  it('follows a change of the address', async () => {
    await start()
    history.replaceState(null, '', '/talk/index.html#agenda')
    window.dispatchEvent(new Event('hashchange'))
    expect(shownSlides()).toEqual(['agenda'])
  })

  it('pages by slide with the arrow, page, Home and End keys in browse mode', async () => {
    await start()
    expect(press('ArrowRight').defaultPrevented).toBe(true)
    expect(shownSlides()).toEqual(['agenda'])
    press('PageDown')
    expect(shownSlides()).toEqual(['numbers'])
    press('ArrowLeft')
    press('PageUp')
    expect(shownSlides()).toEqual(['cover'])
    press('End')
    expect(shownSlides()).toEqual(['numbers'])
    press('Home')
    expect(shownSlides()).toEqual(['cover'])
  })

  it('leaves keys with a modifier, keys typed into a field and other keys alone', async () => {
    await start()
    expect(press('ArrowRight', { metaKey: true }).defaultPrevented).toBe(false)
    expect(press('a').defaultPrevented).toBe(false)
    expect(press('f').defaultPrevented).toBe(false)
    expect(press(' ').defaultPrevented).toBe(false)
    const input = document.createElement('input')
    slide('cover').firstElementChild?.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(shownSlides()).toEqual(['cover'])
  })
})

describe('deck shell modes', () => {
  it('shows every fragment outside presentation mode and reveals them one step at a time in it', async () => {
    await start()
    shell().goTo('agenda')
    expect(pending()).toEqual([])

    shell().setMode('present')
    expect(pending()).toEqual(['One', 'Two'])
    press(' ')
    expect(pending()).toEqual(['Two'])
    press('ArrowRight')
    expect(pending()).toEqual([])
    press('ArrowLeft')
    expect(pending()).toEqual(['Two'])
    press('ArrowRight')
    press('ArrowRight')
    expect(shownSlides()).toEqual(['numbers'])

    press('ArrowLeft')
    expect(shownSlides()).toEqual(['agenda'])
    expect(pending()).toEqual([])

    press('ArrowLeft')
    shell().setMode('browse')
    expect(pending()).toEqual([])
    expect(document.querySelector('.dc-slide section [data-dc-pending]')).toBeNull()
  })

  it('asks the app to leave the presentation on Escape instead of leaving by itself', async () => {
    await start()
    shell().setMode('present')
    logs.length = 0
    press('Escape')
    expect(messages()).toEqual([{ type: 'exit' }])
    expect(shell().state().mode).toBe('present')
  })

  it('lays all slides out as a grid in overview, moves the selection with the arrows and opens it with Enter', async () => {
    vi.stubGlobal('innerWidth', 600)
    await start()
    shell().setMode('overview')
    expect(deck().getAttribute('data-mode')).toBe('overview')
    expect(stageStyle('--dc-columns')).toBe('2')
    expect(document.querySelectorAll('.dc-slide')).toHaveLength(3)

    press('ArrowDown')
    expect(shownSlides()).toEqual(['numbers'])
    press('ArrowUp')
    press('ArrowRight')
    expect(shownSlides()).toEqual(['agenda'])
    press('Enter')
    expect(shell().state()).toMatchObject({ slide: 'agenda', mode: 'browse' })
  })

  it('opens the slide the user clicks in overview', async () => {
    await start()
    shell().setMode('overview')
    slide('numbers').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(shell().state()).toMatchObject({ slide: 'numbers', mode: 'browse' })
  })

  it('ignores a mode it does not know', async () => {
    await start()
    shell().setMode('edit')
    expect(shell().state().mode).toBe('browse')
  })
})

describe('deck shell refresh', () => {
  it('replaces only the slide whose file changed and keeps the mode and the current slide', async () => {
    await start()
    shell().goTo('agenda')
    shell().setMode('overview')
    const cover = slide('cover').firstElementChild
    const agenda = slide('agenda').firstElementChild
    files.set('/talk/slides/agenda.html', section('<h2>New agenda</h2>'))

    expect(await shell().refresh()).toBe(true)
    expect(slide('cover').firstElementChild).toBe(cover)
    expect(slide('agenda').firstElementChild).not.toBe(agenda)
    expect(slide('agenda').querySelector('h2')?.textContent).toBe('New agenda')
    expect(shell().state()).toMatchObject({ slide: 'agenda', title: 'New agenda', mode: 'overview' })
  })

  it('adds, removes and reorders slides after the manifest', async () => {
    await start()
    const numbers = slide('numbers')
    files.set('/talk/slides/thanks.html', section('<h1>Thanks</h1>'))
    manifest = { ...manifest, slides: ['numbers', 'cover', 'thanks'] }

    await shell().refresh()
    expect(order()).toEqual(['numbers', 'cover', 'thanks'])
    expect(slide('numbers')).toBe(numbers)
    expect(shell().state()).toMatchObject({ slide: 'cover', index: 1, count: 3 })
  })

  it('moves to the neighbouring slide when the current one was removed', async () => {
    await start()
    shell().goTo('agenda')
    manifest = { ...manifest, slides: ['cover', 'numbers'] }
    await shell().refresh()
    expect(shownSlides()).toEqual(['numbers'])
    expect(location.hash).toBe('#numbers')

    manifest = { ...manifest, slides: ['cover'] }
    await shell().refresh()
    expect(shownSlides()).toEqual(['cover'])
  })

  it('does not scroll the overview back to the current slide when another slide changed', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    await start()
    shell().setMode('overview')
    scrolled.mockClear()
    files.set('/talk/slides/numbers.html', section('<p>Changed</p>'))
    await shell().refresh()
    expect(scrolled).not.toHaveBeenCalled()

    shell().goTo('numbers')
    expect(scrolled).toHaveBeenCalledOnce()
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })

  it('keeps the step of a presentation within the steps the changed slide still has', async () => {
    await start()
    shell().goTo('agenda')
    shell().setMode('present')
    press(' ')
    press(' ')
    files.set('/talk/slides/agenda.html', section('<h2>Agenda</h2><p class="fragment">Only</p>'))
    await shell().refresh()
    expect(pending()).toEqual([])
    press('ArrowLeft')
    expect(pending()).toEqual(['Only'])
  })

  it('does nothing when no file changed', async () => {
    await start()
    const nodes = order().map((id) => slide(id).firstElementChild)
    logs.length = 0
    await shell().refresh()
    expect(order().map((id) => slide(id).firstElementChild)).toEqual(nodes)
    expect(messages()).toEqual([])
  })

  it('reloads deck.css when its text changed and not otherwise', async () => {
    await start()
    const link = document.getElementById('dc-deck-sheet') as HTMLLinkElement
    await shell().refresh()
    expect(new URL(link.href).search).toBe('')
    files.set('/talk/deck.css', '.slide{padding:120px}')
    await shell().refresh()
    expect(document.getElementById('dc-deck-sheet')).toBe(link)
    expect(new URL(link.href).search).toBe('?t=1')
  })

  it('keeps what it shows when the manifest cannot be read during a refresh', async () => {
    await start()
    manifest = null
    expect(await shell().refresh()).toBe(true)
    expect(order()).toEqual(['cover', 'agenda', 'numbers'])
    expect(document.querySelector('.dc-notice')?.textContent).toBe('')
  })
})

describe('page numbers', () => {
  const counters = () => stageStyle('counter-reset')

  it('numbers every slide wrapper in a counter and keeps the number of slides in another, on the stage and not in the slides', async () => {
    await start()
    expect(document.getElementById('dc-deck-style')?.textContent).toContain('.dc-slide{counter-increment:dc-slide}')
    expect(counters()).toBe('dc-slide 0 dc-slides 3')
    expect(slide('cover').firstElementChild?.getAttribute('style')).toBeNull()
  })

  it('updates the number of slides when a refresh adds or removes slides', async () => {
    await start()
    files.set('/talk/slides/thanks.html', section('<h1>Thanks</h1>'))
    manifest = { ...manifest, slides: ['cover', 'agenda', 'numbers', 'thanks'] }
    await shell().refresh()
    expect(counters()).toBe('dc-slide 0 dc-slides 4')

    manifest = { ...manifest, slides: ['thanks'] }
    await shell().refresh()
    expect(counters()).toBe('dc-slide 0 dc-slides 1')

    manifest = { ...manifest, slides: [] }
    await shell().refresh()
    expect(counters()).toBe('dc-slide 0 dc-slides 0')
  })
})

describe('files a slide refers to', () => {
  const EMBED = '/talk/embeds/demo.html'
  const IMAGE = '/talk/assets/chart.png'
  const frame = () => slide('cover').querySelector('iframe') as HTMLIFrameElement
  const image = () => slide('cover').querySelector('img') as HTMLImageElement
  const reloads = (element: Element) => vi.spyOn(element, 'setAttribute')

  beforeEach(() => {
    files.set('/talk/slides/cover.html', section('<h1>Cover</h1><iframe src="embeds/demo.html#top"></iframe><img src="assets/chart.png">'))
  })

  it('loads an embedded page again when its file appears after the slide was shown', async () => {
    await start()
    const section = slide('cover').firstElementChild
    const reloaded = reloads(frame())
    tags.set(EMBED, '"1"')
    await shell().refresh()
    expect(reloaded.mock.calls).toEqual([['src', 'embeds/demo.html#top']])
    expect(slide('cover').firstElementChild).toBe(section)
  })

  it('loads an embedded page again when its file was changed', async () => {
    tags.set(EMBED, '"1"')
    await start()
    const reloaded = reloads(frame())
    tags.set(EMBED, '"2"')
    await shell().refresh()
    expect(reloaded).toHaveBeenCalledOnce()
  })

  it('loads an image again when its file appears after the slide was shown', async () => {
    await start()
    const reloaded = reloads(image())
    tags.set(IMAGE, '"1"')
    await shell().refresh()
    expect(reloaded.mock.calls).toEqual([['src', 'assets/chart.png']])
  })

  it('loads an image again when its file was replaced, and shows it gone when the file was removed', async () => {
    tags.set(IMAGE, '"1"')
    await start()
    const reloaded = reloads(image())
    tags.set(IMAGE, '"2"')
    await shell().refresh()
    expect(reloaded).toHaveBeenCalledOnce()
    tags.delete(IMAGE)
    await shell().refresh()
    expect(reloaded).toHaveBeenCalledTimes(2)
  })

  it('leaves an embedded page and an image alone when their files did not change, whatever else changed', async () => {
    tags.set(EMBED, '"1"')
    tags.set(IMAGE, '"1"')
    await start()
    const frameReloaded = reloads(frame())
    const imageReloaded = reloads(image())
    files.set('/talk/slides/numbers.html', section('<p>Changed</p>'))
    await shell().refresh()
    await shell().refresh()
    expect(frameReloaded).not.toHaveBeenCalled()
    expect(imageReloaded).not.toHaveBeenCalled()
  })

  it('reloads only the element whose file changed', async () => {
    tags.set(EMBED, '"1"')
    tags.set(IMAGE, '"1"')
    await start()
    const frameReloaded = reloads(frame())
    const imageReloaded = reloads(image())
    tags.set(IMAGE, '"2"')
    await shell().refresh()
    expect(imageReloaded).toHaveBeenCalledOnce()
    expect(frameReloaded).not.toHaveBeenCalled()
  })

  it('loads audio and video again through their element, also when the file is named by a source element', async () => {
    const load = vi.fn()
    HTMLMediaElement.prototype.load = load
    files.set('/talk/slides/cover.html', section('<audio src="assets/a.wav"></audio><video><source src="assets/v.webm"></video>'))
    await start()
    const audio = reloads(slide('cover').querySelector('audio')!)
    tags.set('/talk/assets/a.wav', '"1"')
    tags.set('/talk/assets/v.webm', '"1"')
    await shell().refresh()
    expect(audio.mock.calls).toEqual([['src', 'assets/a.wav']])
    expect(load).toHaveBeenCalledOnce()
    expect(load.mock.instances[0]).toBe(slide('cover').querySelector('video'))
  })

  it('asks once for a file that several elements use, without caching, and never asks another site', async () => {
    files.set('/talk/slides/cover.html', section('<img src="assets/chart.png"><img src="https://example.com/x.png">'))
    files.set('/talk/slides/agenda.html', section('<img src="assets/chart.png#again">'))
    await start()
    expect(asked).toEqual([IMAGE])
  })
})

describe('deck shell measurements', () => {
  it('gives the place of the current slide in the viewport', async () => {
    await start()
    vi.spyOn(slide('cover'), 'getBoundingClientRect').mockReturnValue(rect(24, 114, 960, 540))
    expect(shell().stageRect()).toEqual({ x: 24, y: 114, width: 960, height: 540 })
  })

  it('lists the outermost elements that leave the 1920 by 1080 frame of each slide, in slide pixels', async () => {
    files.set('/talk/slides/numbers.html', section('<div class="table wide"><p>Row</p></div><p class="note">fits</p>'))
    await start()
    for (const id of ['cover', 'agenda', 'numbers']) vi.spyOn(slide(id), 'getBoundingClientRect').mockReturnValue(rect(100, 50, 960, 540))
    vi.spyOn(slide('numbers').querySelector('.table')!, 'getBoundingClientRect').mockReturnValue(rect(148, 98, 960, 600))
    vi.spyOn(slide('numbers').querySelector('.table p')!, 'getBoundingClientRect').mockReturnValue(rect(148, 98, 960, 600))
    vi.spyOn(slide('numbers').querySelector('.note')!, 'getBoundingClientRect').mockReturnValue(rect(148, 98, 200, 40))

    expect(shell().overflow()).toEqual([
      { slide: 'numbers', elements: [{ element: 'div.table', text: 'Row', left: 96, top: 96, right: 2016, bottom: 1296 }] },
    ])
  })
})

describe('deck shell in an exported file', () => {
  const exported = `<div id="dc-deck" data-mode="overview"><div class="dc-stage" style="--dc-scale:0.2;--dc-columns:3">
    <div class="dc-slide" data-slide="cover"><section><h1>Cover</h1></section></div>
    <div class="dc-slide" data-slide="agenda" data-current=""><section><p class="fragment" data-dc-pending="">Step</p></section></div>
  </div><div class="dc-notice"></div></div>`

  async function startExported() {
    const state = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    run()
    document.body.innerHTML = exported
    state.mockRestore()
    tracked(() => document.dispatchEvent(new Event('DOMContentLoaded')))
    await settle()
  }

  it('takes over the slides that are already in the document, even when they come after the script, and fetches nothing', async () => {
    await startExported()
    expect(fetched).toEqual([])
    expect(order()).toEqual(['cover', 'agenda'])
    expect(document.querySelectorAll('#dc-deck')).toHaveLength(1)
    expect(await shell().refresh()).toBe(false)
  })

  it('resets the state the export carried: mode, current slide, hidden steps and scale', async () => {
    vi.stubGlobal('innerWidth', 1008)
    vi.stubGlobal('innerHeight', 768)
    await startExported()
    expect(deck().getAttribute('data-mode')).toBe('browse')
    expect(shownSlides()).toEqual(['cover'])
    expect(pending()).toEqual([])
    expect(Number(stageStyle('--dc-scale'))).toBeCloseTo(0.5)
  })

  it('counts the slides of the file, whether or not the export carried the count', async () => {
    await startExported()
    expect(stageStyle('counter-reset')).toBe('dc-slide 0 dc-slides 2')
  })

  it('does not add its styles a second time', async () => {
    const style = document.createElement('style')
    style.id = 'dc-deck-style'
    document.head.appendChild(style)
    await startExported()
    expect(document.querySelectorAll('#dc-deck-style')).toHaveLength(1)
    expect(document.querySelector('link')).toBeNull()
  })

  it('offers overview and presentation from the keyboard, and leaves the presentation on Escape by itself', async () => {
    await startExported()
    expect(document.querySelector('.dc-hint')?.textContent).toContain('F')
    press('o')
    expect(shell().state().mode).toBe('overview')
    press('o')
    press('f')
    expect(shell().state().mode).toBe('present')
    logs.length = 0
    press('Escape')
    expect(shell().state().mode).toBe('browse')
    expect(messages().some((message) => message.type === 'exit')).toBe(false)
  })
})
