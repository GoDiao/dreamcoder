import { browserHostChannel, type BrowserHostChannel } from './hostChannel.js'
import { BROWSER_MCP_PATH, BROWSER_MCP_TOKEN_ENV, BROWSER_MCP_URL_ENV } from './names.js'
import { browserSessionTokens, type BrowserSessionTokens } from './sessionTokens.js'

export function browserMcpChildEnv(
  sessionId: string,
  serverUrl: string | undefined,
  deps: { channel?: BrowserHostChannel; tokens?: BrowserSessionTokens } = {},
): Record<string, string> {
  const channel = deps.channel ?? browserHostChannel
  const tokens = deps.tokens ?? browserSessionTokens
  if (!serverUrl || !channel.isConnected()) return {}
  return {
    [BROWSER_MCP_URL_ENV]: `${serverUrl}${BROWSER_MCP_PATH}`,
    [BROWSER_MCP_TOKEN_ENV]: tokens.issue(sessionId),
  }
}
