import { ARTIFACT_SHELL_PREFIX, isSameEntryHtml, shellEntryHtml } from './artifactShell.js'

export const CANVAS_SCRIPT_PATH = `${ARTIFACT_SHELL_PREFIX}canvas.js`
export const CANVAS_ENTRY_HTML = shellEntryHtml('Canvas', CANVAS_SCRIPT_PATH)

export function isCanvasEntryHtml(html: string): boolean {
  return isSameEntryHtml(html, CANVAS_ENTRY_HTML)
}

export function isSafeBoardFile(file: string): boolean {
  if (file.trim() === '' || file.includes('\0')) return false
  if (file.startsWith('/') || file.startsWith('\\') || /^[a-z]:/i.test(file)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(file)) return false
  return !file.split(/[\\/]/).includes('..')
}
