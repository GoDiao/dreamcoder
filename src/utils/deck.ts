import { ARTIFACT_SHELL_PREFIX, isSameEntryHtml, shellEntryHtml } from './artifactShell.js'

export const DECK_SCRIPT_PATH = `${ARTIFACT_SHELL_PREFIX}deck.js`
export const DECK_ENTRY_HTML = shellEntryHtml('Deck', DECK_SCRIPT_PATH)
export const DECK_STYLESHEET_FILE = 'deck.css'
export const DECK_SLIDES_DIR = 'slides'
export const DECK_WIDTH = 1920
export const DECK_HEIGHT = 1080
export const DECK_SLIDE_COUNTER = 'dc-slide'
export const DECK_SLIDES_COUNTER = 'dc-slides'

export function isDeckEntryHtml(html: string): boolean {
  return isSameEntryHtml(html, DECK_ENTRY_HTML)
}

export function isSafeSlideId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

export function slideFile(id: string): string {
  return `${DECK_SLIDES_DIR}/${id}.html`
}
