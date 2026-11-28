import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { getDenyRuleForTool } from '../../utils/permissions/permissions.js'
import {
  buildMcpToolName,
  getMcpDisplayName,
  getMcpPrefix,
  mcpInfoFromString,
} from './mcpStringUtils.js'
import { commandBelongsToServer } from './utils.js'

const API_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/
const server = 'company-internal-knowledge-base'
const longTool = 'search_documents_by_semantic_similarity'
const longServer = 'company-internal-knowledge-base-for-the-whole-organisation'

function denyRuleFor(rule: string, serverName: string, toolName: string) {
  return getDenyRuleForTool(
    {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { userSettings: [rule] },
    },
    {
      name: buildMcpToolName(serverName, toolName),
      mcpInfo: { serverName, toolName },
    },
  )
}

describe('MCP tool name length', () => {
  test('a name within the limit is unchanged', () => {
    expect(buildMcpToolName('github', 'create issue')).toBe(
      'mcp__github__create_issue',
    )
  })

  test('a long tool name is shortened under the server prefix', () => {
    const name = buildMcpToolName(server, longTool)

    expect(name).toMatch(API_TOOL_NAME)
    expect(name.startsWith(`mcp__${server}__`)).toBe(true)
    expect(buildMcpToolName(server, longTool)).toBe(name)
  })

  test('tool names that share a long beginning stay distinct', () => {
    expect(buildMcpToolName(server, `${longTool}_v1`)).not.toBe(
      buildMcpToolName(server, `${longTool}_v2`),
    )
  })

  test('a long server name keeps one prefix for its tools and prompts', () => {
    const name = buildMcpToolName(longServer, longTool)
    const prefix = getMcpPrefix(longServer)

    expect(name).toMatch(API_TOOL_NAME)
    expect(name.startsWith(prefix)).toBe(true)
    expect(getMcpPrefix(mcpInfoFromString(name)!.serverName)).toBe(prefix)
    expect(getMcpDisplayName(name, longServer)).toBe(name.slice(prefix.length))
    expect(
      commandBelongsToServer(
        { name: `${prefix}summarise` } as Parameters<
          typeof commandBelongsToServer
        >[0],
        longServer,
      ),
    ).toBe(true)
  })

  test.each([
    [`mcp__${server}__${longTool}`, server],
    [buildMcpToolName(server, longTool), server],
    [`mcp__${longServer}__${longTool}`, longServer],
    [`mcp__${longServer}`, longServer],
    [`mcp__${longServer}__*`, longServer],
    [getMcpPrefix(longServer).slice(0, -2), longServer],
  ])('the deny rule %s still matches', (rule, serverName) => {
    expect(denyRuleFor(rule, serverName, longTool)).not.toBeNull()
  })

  test('a deny rule for another server does not match', () => {
    expect(denyRuleFor('mcp__github', longServer, longTool)).toBeNull()
  })
})
