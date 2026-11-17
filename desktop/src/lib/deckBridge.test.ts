import { describe, expect, it } from 'vitest'
import { DECK_LOG_PREFIX, deckEditingCall, deckModeCall, isDeckEdit, isDeckRect, parseDeckMessage, slideFile } from './deckBridge'

const SCRIPT = 'dreamcoder-project://abc/__dreamcoder__/deck.js'
const line = (payload: unknown) => `${DECK_LOG_PREFIX}${JSON.stringify(payload)}`
const state = (overrides: Record<string, unknown> = {}) => ({ type: 'state', artifact: 'deck-1', slide: 'cover', title: 'Cover', index: 0, count: 3, mode: 'browse', editing: false, ...overrides })

describe('parseDeckMessage', () => {
  it('reads the state of a deck and the request to leave the presentation', () => {
    expect(parseDeckMessage(line(state()), SCRIPT)).toEqual(state())
    expect(parseDeckMessage(line(state({ mode: 'present', index: 2 })), SCRIPT)).toMatchObject({ mode: 'present', index: 2 })
    expect(parseDeckMessage(line({ type: 'exit' }), SCRIPT)).toEqual({ type: 'exit' })
  })

  it('reads the state of a deck without slides or without an artifact id, and drops fields it does not know', () => {
    const empty = state({ artifact: null, slide: null, title: null, index: -1, count: 0, extra: 'x' })
    expect(parseDeckMessage(line(empty), SCRIPT)).toEqual({ type: 'state', artifact: null, slide: null, title: null, index: -1, count: 0, mode: 'browse', editing: false })
  })

  it('reads whether editing is on, and takes a state without the field as not editing', () => {
    expect(parseDeckMessage(line(state({ editing: true })), SCRIPT)).toMatchObject({ editing: true })
    const { editing: _editing, ...older } = state()
    expect(parseDeckMessage(line(older), SCRIPT)).toMatchObject({ editing: false })
  })

  it('reads a new order of the slides, an edit and a request to delete the current slide', () => {
    expect(parseDeckMessage(line({ type: 'order', slides: ['b', 'a'] }), SCRIPT)).toEqual({ type: 'order', slides: ['b', 'a'] })
    expect(parseDeckMessage(line({ type: 'edit', extra: 'x' }), SCRIPT)).toEqual({ type: 'edit' })
    expect(parseDeckMessage(line({ type: 'delete' }), SCRIPT)).toEqual({ type: 'delete' })
    expect(parseDeckMessage(line({ type: 'busy', on: true }), SCRIPT)).toEqual({ type: 'busy', on: true })
    expect(parseDeckMessage(line({ type: 'busy', on: 'yes' }), SCRIPT)).toBeNull()
  })

  it('ignores an order with ids that are not slide ids', () => {
    for (const bad of [{ type: 'order', slides: 'a' }, { type: 'order', slides: ['a', 3] }, { type: 'order', slides: ['../x'] }]) {
      expect(parseDeckMessage(line(bad), SCRIPT)).toBeNull()
    }
  })

  it('ignores a message that did not come from the deck script, such as one logged by a slide, an embedded page or another site', () => {
    const forged = line(state())
    expect(parseDeckMessage(forged, 'dreamcoder-project://abc/talk/index.html')).toBeNull()
    expect(parseDeckMessage(forged, 'dreamcoder-project://abc/talk/embeds/demo.html')).toBeNull()
    expect(parseDeckMessage(forged, 'dreamcoder-project://abc/__dreamcoder__/canvas.js')).toBeNull()
    expect(parseDeckMessage(forged, 'https://example.com/__dreamcoder__/deck.js')).toBeNull()
    expect(parseDeckMessage(forged, '')).toBeNull()
  })

  it('ignores ordinary logs, the prefix of the canvas, broken JSON and unknown types', () => {
    expect(parseDeckMessage('hello', SCRIPT)).toBeNull()
    expect(parseDeckMessage(`dreamcoder-canvas:${JSON.stringify(state())}`, SCRIPT)).toBeNull()
    expect(parseDeckMessage(`${DECK_LOG_PREFIX}{`, SCRIPT)).toBeNull()
    expect(parseDeckMessage(line({ type: 'zoom' }), SCRIPT)).toBeNull()
    expect(parseDeckMessage(line(null), SCRIPT)).toBeNull()
    expect(parseDeckMessage(line([state()]), SCRIPT)).toBeNull()
  })

  it('ignores a state with a field of the wrong shape or a position outside the deck', () => {
    for (const bad of [{ mode: 'edit' }, { artifact: 7 }, { slide: 7 }, { title: 7 }, { index: 1.5 }, { index: 3 }, { index: -2 }, { count: -1 }, { count: '3' }]) {
      expect(parseDeckMessage(line(state(bad)), SCRIPT)).toBeNull()
    }
  })
})

describe('deck calls', () => {
  it('builds the call that sets a mode and the path of a slide file', () => {
    expect(deckModeCall('overview')).toBe('window.__dreamcoderDeck?.setMode("overview")')
    expect(slideFile('agenda')).toBe('slides/agenda.html')
  })

  it('builds the call that turns editing on or off', () => {
    expect(deckEditingCall(true)).toBe('window.__dreamcoderDeck?.setEditing(true)')
    expect(deckEditingCall(false)).toBe('window.__dreamcoderDeck?.setEditing(false)')
  })

  it('accepts only an edit with a slide id and the new and previous text', () => {
    expect(isDeckEdit({ id: 'cover', html: '<section></section>', previous: '<section>x</section>' })).toBe(true)
    expect(isDeckEdit({ id: '../cover', html: '', previous: '' })).toBe(false)
    expect(isDeckEdit({ id: 'cover', html: '<section></section>' })).toBe(false)
    expect(isDeckEdit(null)).toBe(false)
  })

  it('accepts only a rectangle with a size', () => {
    expect(isDeckRect({ x: 0, y: 0, width: 10, height: 5 })).toBe(true)
    expect(isDeckRect({ x: 0, y: 0, width: 0, height: 5 })).toBe(false)
    expect(isDeckRect({ x: 0, y: 0, width: 10 })).toBe(false)
    expect(isDeckRect({ x: '0', y: 0, width: 10, height: 5 })).toBe(false)
    expect(isDeckRect(null)).toBe(false)
  })
})
