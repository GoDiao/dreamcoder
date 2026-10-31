import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { BrowserService } from './service.js'
import type { BrowserSessionTokens } from './sessionTokens.js'
import { BROWSER_MCP_SERVER_NAME } from './names.js'
import { BROWSER_TOOLS } from './tools.js'

export type BrowserMcpDeps = {
  service: BrowserService
  tokens: BrowserSessionTokens
  version: string
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const [scheme, token] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

function createServer(deps: BrowserMcpDeps, sessionId: string) {
  const server = new McpServer({ name: BROWSER_MCP_SERVER_NAME, version: deps.version })
  for (const tool of BROWSER_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly, openWorldHint: true },
      },
      async (args, extra) => {
        const result = await tool.run(deps.service, sessionId, args as Record<string, unknown>, extra.signal)
        return { content: result.content, ...(result.isError ? { isError: true } : {}) }
      },
    )
  }
  return server
}

export async function handleBrowserMcpRequest(request: Request, deps: BrowserMcpDeps): Promise<Response> {
  const token = bearerToken(request)
  const sessionId = token ? deps.tokens.resolve(token) : null
  if (!sessionId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  }
  const server = createServer(deps, sessionId)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    void server.close().catch(() => undefined)
  }
}
