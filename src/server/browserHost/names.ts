export const BROWSER_MCP_SERVER_NAME = 'dreamcoder-browser'
export const BROWSER_MCP_PATH = '/browser-mcp'
export const BROWSER_MCP_URL_ENV = 'DREAMCODER_BROWSER_MCP_URL'
export const BROWSER_MCP_TOKEN_ENV = 'DREAMCODER_BROWSER_MCP_TOKEN'
export const WEB_CLONE_BROWSER_PATH = '/web-clone-browser'
export const WEB_CLONE_URL_ENV = 'DREAMCODER_WEB_CLONE_URL'
export const WEB_CLONE_TOKEN_ENV = 'DREAMCODER_WEB_CLONE_TOKEN'

export const BROWSER_TOOL_NAMES = [
  'navigate',
  'snapshot',
  'scroll',
  'click',
  'type',
  'press_key',
  'screenshot',
  'console',
  'network',
  'back',
  'wait_for',
  'styles',
  'evaluate',
  'emulate',
  'close_tab',
] as const

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number]
