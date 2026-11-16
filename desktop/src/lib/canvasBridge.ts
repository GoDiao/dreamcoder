import { ARTIFACT_SHELL_PREFIX, parseShellMessage } from './shellBridge'

export const CANVAS_LOG_PREFIX = 'dreamcoder-canvas:'
const CANVAS_SCRIPT_PATH = `${ARTIFACT_SHELL_PREFIX}canvas.js`

export function canvasBoardTitleCall(documentUrl: string): string {
  return `window.__dreamcoderCanvas ? window.__dreamcoderCanvas.boardTitle(${JSON.stringify(documentUrl)}) : null`
}

export type CanvasAction =
  | { type: 'move'; id: string; x: number; y: number; width: number; height: number }
  | { type: 'open'; id: string }
  | { type: 'busy'; on: boolean }

export type CanvasMessage = { type: 'ready'; artifact: string } | CanvasAction

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseCanvasMessage(message: string, sourceId: string): CanvasMessage | null {
  const record = parseShellMessage(message, sourceId, CANVAS_LOG_PREFIX, CANVAS_SCRIPT_PATH)
  if (!record) return null
  if (record.type === 'ready') return typeof record.artifact === 'string' && record.artifact !== '' ? { type: 'ready', artifact: record.artifact } : null
  if (record.type === 'busy') return typeof record.on === 'boolean' ? { type: 'busy', on: record.on } : null
  if (typeof record.id !== 'string' || record.id === '') return null
  if (record.type === 'open') return { type: 'open', id: record.id }
  if (record.type === 'move' && finite(record.x) && finite(record.y) && finite(record.width) && finite(record.height) && record.width > 0 && record.height > 0) {
    return { type: 'move', id: record.id, x: record.x, y: record.y, width: record.width, height: record.height }
  }
  return null
}
