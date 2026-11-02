export const CANVAS_RESERVED_PREFIX = '/__dreamcoder__/'
export const CANVAS_SCRIPT_PATH = `${CANVAS_RESERVED_PREFIX}canvas.js`
export const CANVAS_SHELL_DIRNAME = 'canvas-shell'
export const CANVAS_SHELL_FILES: readonly string[] = ['canvas.js']

export const CANVAS_ENTRY_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Canvas</title>
</head>
<body>
<script src="${CANVAS_SCRIPT_PATH}"></script>
</body>
</html>
`

export function isCanvasEntryHtml(html: string): boolean {
  return html.replace(/\s+/g, ' ').trim() === CANVAS_ENTRY_HTML.replace(/\s+/g, ' ').trim()
}

export function isSafeBoardFile(file: string): boolean {
  if (file.trim() === '' || file.includes('\0')) return false
  if (file.startsWith('/') || file.startsWith('\\') || /^[a-z]:/i.test(file)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(file)) return false
  return !file.split(/[\\/]/).includes('..')
}
