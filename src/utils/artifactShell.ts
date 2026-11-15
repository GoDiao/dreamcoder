export const ARTIFACT_SHELL_PREFIX = '/__dreamcoder__/'
export const ARTIFACT_SHELL_DIRNAME = 'artifact-shell'
export const ARTIFACT_SHELL_FILES: readonly string[] = ['canvas.js', 'deck.js']

export function shellEntryHtml(title: string, scriptPath: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
</head>
<body>
<script src="${scriptPath}"></script>
</body>
</html>
`
}

export function isSameEntryHtml(html: string, expected: string): boolean {
  return html.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim()
}
