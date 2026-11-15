export const PROJECT_PROTOCOL = 'dreamcoder-project:'
const SHELL = '(window.__dreamcoderCanvas || window.__dreamcoderDeck)'

export const ARTIFACT_SHELL_PREFIX = '/__dreamcoder__/'
export const SHELL_REFRESH_CALL = `${SHELL} ? ${SHELL}.refresh() : false`

export function shellSchemeCall(scheme: 'light' | 'dark'): string {
  return `${SHELL}?.setScheme(${JSON.stringify(scheme)})`
}

function isShellScript(sourceId: string, scriptPath: string): boolean {
  try {
    const url = new URL(sourceId)
    return url.protocol === PROJECT_PROTOCOL && url.pathname === scriptPath
  } catch {
    return false
  }
}

export function parseShellMessage(message: string, sourceId: string, prefix: string, scriptPath: string): Record<string, unknown> | null {
  if (!message.startsWith(prefix) || !isShellScript(sourceId, scriptPath)) return null
  let data: unknown
  try {
    data = JSON.parse(message.slice(prefix.length))
  } catch {
    return null
  }
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null
}
