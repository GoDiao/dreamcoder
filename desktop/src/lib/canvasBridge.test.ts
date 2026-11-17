import { describe, expect, it } from 'vitest'
import { CANVAS_LOG_PREFIX, parseCanvasMessage } from './canvasBridge'

const SCRIPT = 'dreamcoder-project://abc/__dreamcoder__/canvas.js'
const line = (payload: unknown) => `${CANVAS_LOG_PREFIX}${JSON.stringify(payload)}`

describe('parseCanvasMessage', () => {
  it('reads a move and an open from the canvas script', () => {
    expect(parseCanvasMessage(line({ type: 'move', id: 'a', x: 1, y: -2, width: 300, height: 200 }), SCRIPT)).toEqual({ type: 'move', id: 'a', x: 1, y: -2, width: 300, height: 200 })
    expect(parseCanvasMessage(line({ type: 'open', id: 'a' }), SCRIPT)).toEqual({ type: 'open', id: 'a' })
  })

  it('reads when a drag starts and ends being an edit', () => {
    expect(parseCanvasMessage(line({ type: 'busy', on: true }), SCRIPT)).toEqual({ type: 'busy', on: true })
    expect(parseCanvasMessage(line({ type: 'busy', on: false }), SCRIPT)).toEqual({ type: 'busy', on: false })
    expect(parseCanvasMessage(line({ type: 'busy' }), SCRIPT)).toBeNull()
  })

  it('reads the message that says which artifact the canvas shows', () => {
    expect(parseCanvasMessage(line({ type: 'ready', artifact: 'canvas-1' }), SCRIPT)).toEqual({ type: 'ready', artifact: 'canvas-1' })
    expect(parseCanvasMessage(line({ type: 'ready' }), SCRIPT)).toBeNull()
    expect(parseCanvasMessage(line({ type: 'ready', artifact: 7 }), SCRIPT)).toBeNull()
  })

  it('ignores a message that did not come from the canvas script, such as one logged by a board page', () => {
    const forged = line({ type: 'open', id: 'a' })
    expect(parseCanvasMessage(forged, 'dreamcoder-project://abc/flow/home.html')).toBeNull()
    expect(parseCanvasMessage(forged, 'dreamcoder-project://abc/x/__dreamcoder__/canvas.js/../home.html')).toBeNull()
    expect(parseCanvasMessage(forged, 'https://example.com/__dreamcoder__/canvas.js')).toBeNull()
    expect(parseCanvasMessage(forged, '')).toBeNull()
    expect(parseCanvasMessage(forged, 'not a url')).toBeNull()
  })

  it('ignores ordinary logs, broken JSON and unknown types', () => {
    expect(parseCanvasMessage('hello', SCRIPT)).toBeNull()
    expect(parseCanvasMessage(`${CANVAS_LOG_PREFIX}{`, SCRIPT)).toBeNull()
    expect(parseCanvasMessage(line({ type: 'delete', id: 'a' }), SCRIPT)).toBeNull()
    expect(parseCanvasMessage(line(null), SCRIPT)).toBeNull()
    expect(parseCanvasMessage(line([]), SCRIPT)).toBeNull()
  })

  it('ignores a move with a missing id or numbers that are not finite or not a size', () => {
    expect(parseCanvasMessage(line({ type: 'move', x: 1, y: 1, width: 1, height: 1 }), SCRIPT)).toBeNull()
    expect(parseCanvasMessage(line({ type: 'move', id: '', x: 1, y: 1, width: 1, height: 1 }), SCRIPT)).toBeNull()
    expect(parseCanvasMessage(line({ type: 'move', id: 'a', x: '1', y: 1, width: 1, height: 1 }), SCRIPT)).toBeNull()
    expect(parseCanvasMessage(line({ type: 'move', id: 'a', x: 1, y: 1, width: 0, height: 1 }), SCRIPT)).toBeNull()
    expect(parseCanvasMessage(`${CANVAS_LOG_PREFIX}{"type":"move","id":"a","x":1e999,"y":1,"width":1,"height":1}`, SCRIPT)).toBeNull()
  })
})
