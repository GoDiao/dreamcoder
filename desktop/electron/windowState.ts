import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const MIN_WINDOW_WIDTH = 960
export const MIN_WINDOW_HEIGHT = 640
const MIN_VISIBLE_PIXELS = 64

export type Rect = { x: number; y: number; width: number; height: number }
export type StoredWindowState = Rect & { maximized: boolean }
export type DisplayInfo = { bounds: Rect; scaleFactor: number }

export function isPersistableWindowState(state: StoredWindowState): boolean {
  return state.width >= MIN_WINDOW_WIDTH && state.height >= MIN_WINDOW_HEIGHT
}

export function hasMeaningfulIntersection(rect: Rect, area: Rect): boolean {
  return rect.x + rect.width > area.x + MIN_VISIBLE_PIXELS
    && rect.y + rect.height > area.y + MIN_VISIBLE_PIXELS
    && rect.x < area.x + area.width - MIN_VISIBLE_PIXELS
    && rect.y < area.y + area.height - MIN_VISIBLE_PIXELS
}

function scale(rect: Rect, factor: number): Rect {
  return {
    x: Math.round(rect.x * factor),
    y: Math.round(rect.y * factor),
    width: Math.round(rect.width * factor),
    height: Math.round(rect.height * factor),
  }
}

export function toStoredWindowState(bounds: Rect, maximized: boolean, display: DisplayInfo): StoredWindowState {
  return { ...scale(bounds, display.scaleFactor), maximized }
}

export function restorableBounds(state: StoredWindowState, displays: DisplayInfo[]): Rect | null {
  if (displays.length === 0) return scale(state, 1)
  for (const display of displays) {
    const physicalArea = scale(display.bounds, display.scaleFactor)
    if (hasMeaningfulIntersection(state, physicalArea)) return scale(state, 1 / display.scaleFactor)
  }
  return null
}

function parseWindowState(value: unknown): StoredWindowState | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const numbers = ['x', 'y', 'width', 'height'].map((key) => record[key])
  if (!numbers.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null
  const [x, y, width, height] = numbers as number[]
  return { x: x!, y: y!, width: width!, height: height!, maximized: record.maximized === true }
}

export function readWindowState(file: string): StoredWindowState | null {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[electron] failed to read window state ${file}`, error)
    return null
  }
  try {
    const state = parseWindowState(JSON.parse(raw))
    return state && isPersistableWindowState(state) ? state : null
  } catch (error) {
    console.error(`[electron] failed to parse window state ${file}`, error)
    return null
  }
}

export function writeWindowState(file: string, state: StoredWindowState) {
  if (!isPersistableWindowState(state)) return
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state, null, 2))
  } catch (error) {
    console.error(`[electron] failed to write window state ${file}`, error)
  }
}
