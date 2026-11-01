export const CANVAS_LOG_PREFIX = 'dreamcoder-canvas:'
export const CANVAS_SCRIPT_PATH = '/__dreamcoder__/canvas.js'
export const CANVAS_REFRESH_CALL = 'window.__dreamcoderCanvas ? window.__dreamcoderCanvas.refresh() : false'

export function canvasSchemeCall(scheme: 'light' | 'dark'): string {
  return `window.__dreamcoderCanvas?.setScheme(${JSON.stringify(scheme)})`
}

export type CanvasMessage =
  | { type: 'move'; id: string; x: number; y: number; width: number; height: number }
  | { type: 'open'; id: string }

function isCanvasScriptSource(sourceId: string): boolean {
  try {
    return new URL(sourceId).pathname === CANVAS_SCRIPT_PATH
  } catch {
    return false
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseCanvasMessage(message: string, sourceId: string): CanvasMessage | null {
  if (!message.startsWith(CANVAS_LOG_PREFIX) || !isCanvasScriptSource(sourceId)) return null
  let data: unknown
  try {
    data = JSON.parse(message.slice(CANVAS_LOG_PREFIX.length))
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id === '') return null
  if (record.type === 'open') return { type: 'open', id: record.id }
  if (record.type === 'move' && finite(record.x) && finite(record.y) && finite(record.width) && finite(record.height) && record.width > 0 && record.height > 0) {
    return { type: 'move', id: record.id, x: record.x, y: record.y, width: record.width, height: record.height }
  }
  return null
}
