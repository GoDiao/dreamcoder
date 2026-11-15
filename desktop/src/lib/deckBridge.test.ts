import { describe, expect, it } from 'vitest'
import { DECK_LOG_PREFIX, deckModeCall, isDeckRect, parseDeckMessage, slideFile } from './deckBridge'

const SCRIPT = 'dreamcoder-project://abc/__dreamcoder__/deck.js'
const line = (payload: unknown) => `${DECK_LOG_PREFIX}${JSON.stringify(payload)}`
const state = (overrides: Record<string, unknown> = {}) => ({ type: 'state', artifact: 'deck-1', slide: 'cover', title: 'Cover', index: 0, count: 3, mode: 'browse', ...overrides })

describe('parseDeckMessage', () => {
  it('reads the state of a deck and the request to leave the presentation', () => {
    expect(parseDeckMessage(line(state()), SCRIPT)).toEqual(state())
    expect(parseDeckMessage(line(state({ mode: 'present', index: 2 })), SCRIPT)).toMatchObject({ mode: 'present', index: 2 })
    expect(parseDeckMessage(line({ type: 'exit' }), SCRIPT)).toEqual({ type: 'exit' })
  })

  it('reads the state of a deck without slides or without an artifact id, and drops fields it does not know', () => {
    const empty = state({ artifact: null, slide: null, title: null, index: -1, count: 0, extra: 'x' })
    expect(parseDeckMessage(line(empty), SCRIPT)).toEqual({ type: 'state', artifact: null, slide: null, title: null, index: -1, count: 0, mode: 'browse' })
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
    expect(parseDeckMessage(line({ type: 'order', slides: ['a'] }), SCRIPT)).toBeNull()
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

  it('accepts only a rectangle with a size', () => {
    expect(isDeckRect({ x: 0, y: 0, width: 10, height: 5 })).toBe(true)
    expect(isDeckRect({ x: 0, y: 0, width: 0, height: 5 })).toBe(false)
    expect(isDeckRect({ x: 0, y: 0, width: 10 })).toBe(false)
    expect(isDeckRect({ x: '0', y: 0, width: 10, height: 5 })).toBe(false)
    expect(isDeckRect(null)).toBe(false)
  })
})
