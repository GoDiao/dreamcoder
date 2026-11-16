import { ARTIFACT_SHELL_PREFIX, parseShellMessage } from './shellBridge'

export const DECK_LOG_PREFIX = 'dreamcoder-deck:'
const DECK_SCRIPT_PATH = `${ARTIFACT_SHELL_PREFIX}deck.js`
export const DECK_VIEWPORT = { width: 1920, height: 1080, scale: 1, wholePage: false } as const

const DECK_MODES = ['browse', 'overview', 'present'] as const
export type DeckMode = (typeof DECK_MODES)[number]

export type DeckState = {
  artifact: string | null
  slide: string | null
  title: string | null
  index: number
  count: number
  mode: DeckMode
  editing: boolean
}

export type DeckEditMessage = { type: 'order'; slides: string[] } | { type: 'edit' } | { type: 'busy'; on: boolean }

export type DeckRequest = DeckEditMessage | { type: 'delete' }

type DeckMessage = ({ type: 'state' } & DeckState) | { type: 'exit' } | DeckRequest

export type DeckEdit = { id: string; html: string; previous: string }

export type DeckRect = { x: number; y: number; width: number; height: number }

export const DECK_NEXT_CALL = 'window.__dreamcoderDeck?.next()'
export const DECK_PREV_CALL = 'window.__dreamcoderDeck?.prev()'
export const DECK_STAGE_RECT_CALL = 'window.__dreamcoderDeck ? window.__dreamcoderDeck.stageRect() : null'
export const DECK_TAKE_EDIT_CALL = 'window.__dreamcoderDeck ? window.__dreamcoderDeck.takeEdit() : null'

export function deckModeCall(mode: DeckMode): string {
  return `window.__dreamcoderDeck?.setMode(${JSON.stringify(mode)})`
}

export function deckEditingCall(on: boolean): string {
  return `window.__dreamcoderDeck?.setEditing(${on})`
}

function isSlideId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

export function slideFile(id: string): string {
  return `slides/${id}.html`
}

function textOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isMode(value: unknown): value is DeckMode {
  return (DECK_MODES as readonly unknown[]).includes(value)
}

export function parseDeckMessage(message: string, sourceId: string): DeckMessage | null {
  const record = parseShellMessage(message, sourceId, DECK_LOG_PREFIX, DECK_SCRIPT_PATH)
  if (!record) return null
  if (record.type === 'exit') return { type: 'exit' }
  if (record.type === 'order') return Array.isArray(record.slides) && record.slides.every(isSlideId) ? { type: 'order', slides: record.slides } : null
  if (record.type === 'edit' || record.type === 'delete') return { type: record.type }
  if (record.type === 'busy') return typeof record.on === 'boolean' ? { type: 'busy', on: record.on } : null
  if (record.type !== 'state') return null
  const { artifact, slide, title, index, count, mode } = record
  if (!textOrNull(artifact) || !textOrNull(slide) || !textOrNull(title) || !isMode(mode)) return null
  if (!Number.isInteger(index) || !Number.isInteger(count) || (count as number) < 0 || (index as number) < -1 || (index as number) >= Math.max(count as number, 1)) return null
  return { type: 'state', artifact, slide, title, index: index as number, count: count as number, mode, editing: record.editing === true }
}

export function isDeckEdit(value: unknown): value is DeckEdit {
  if (typeof value !== 'object' || value === null) return false
  const edit = value as Record<string, unknown>
  return isSlideId(edit.id) && typeof edit.html === 'string' && typeof edit.previous === 'string'
}

export function isDeckRect(value: unknown): value is DeckRect {
  if (typeof value !== 'object' || value === null) return false
  const rect = value as Record<string, unknown>
  return [rect.x, rect.y, rect.width, rect.height].every((part) => typeof part === 'number' && Number.isFinite(part)) && (rect.width as number) > 0 && (rect.height as number) > 0
}
