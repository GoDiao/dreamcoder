import { browserHostChannel, type BrowserHostChannel } from './hostChannel.js'
import {
  BROWSER_MCP_PATH,
  BROWSER_MCP_TOKEN_ENV,
  BROWSER_MCP_URL_ENV,
  WEB_CLONE_BROWSER_PATH,
  WEB_CLONE_TOKEN_ENV,
  WEB_CLONE_URL_ENV,
} from './names.js'
import { browserSessionTokens, type BrowserSessionTokens } from './sessionTokens.js'
import { webCloneTokens } from './webClone.js'

type ChildEnvDeps = { channel?: BrowserHostChannel; tokens?: BrowserSessionTokens }

function endpointChildEnv(
  sessionId: string,
  serverUrl: string | undefined,
  names: { path: string; urlEnv: string; tokenEnv: string },
  channel: BrowserHostChannel,
  tokens: BrowserSessionTokens,
): Record<string, string> {
  if (!serverUrl || !channel.isConnected()) return {}
  return {
    [names.urlEnv]: `${serverUrl}${names.path}`,
    [names.tokenEnv]: tokens.issue(sessionId),
  }
}

export function browserMcpChildEnv(sessionId: string, serverUrl: string | undefined, deps: ChildEnvDeps = {}): Record<string, string> {
  return endpointChildEnv(
    sessionId,
    serverUrl,
    { path: BROWSER_MCP_PATH, urlEnv: BROWSER_MCP_URL_ENV, tokenEnv: BROWSER_MCP_TOKEN_ENV },
    deps.channel ?? browserHostChannel,
    deps.tokens ?? browserSessionTokens,
  )
}

export function webCloneChildEnv(sessionId: string, serverUrl: string | undefined, deps: ChildEnvDeps = {}): Record<string, string> {
  return endpointChildEnv(
    sessionId,
    serverUrl,
    { path: WEB_CLONE_BROWSER_PATH, urlEnv: WEB_CLONE_URL_ENV, tokenEnv: WEB_CLONE_TOKEN_ENV },
    deps.channel ?? browserHostChannel,
    deps.tokens ?? webCloneTokens,
  )
}
