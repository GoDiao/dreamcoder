import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import type { AssistantMessage } from '../../types/message.js'
import { bashToolHasPermission } from '../../tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { powershellToolHasPermission } from '../../tools/PowerShellTool/powershellPermissions.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { hasPermissionsToUseTool } from './permissions.js'

describe('permission guardrail pipeline', () => {
  let configDir: string
  let originalConfigDir: string | undefined
  let originalFetch: typeof fetch

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'permission-guardrail-'))
    originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
    originalFetch = globalThis.fetch
    process.env.DREAMCODER_CONFIG_DIR = configDir
    mkdirSync(join(configDir, 'dreamcoder'), { recursive: true })
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify({
      permissionGuardrail: {
        enabled: true,
        providerId: 'decision-provider',
        modelId: 'decision-model',
        preset: 'safetyNet',
        threshold: 0.5,
        privacyNoticeVersion: 1,
      },
    }))
    writeFileSync(join(configDir, 'dreamcoder', 'providers.json'), JSON.stringify({
      activeId: null,
      providers: [],
      activeDecisionProviderId: 'decision-provider',
      decisionProviders: [{
        id: 'decision-provider',
        presetId: 'custom',
        name: 'Decision Provider',
        deployment: 'hosted',
        apiFormat: 'openai_decisions',
        baseUrl: 'https://example.com/v1',
        apiKey: 'test-placeholder',
        models: [{ id: 'decision-model' }],
      }],
    }))
    resetSettingsCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
    else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
    resetSettingsCache()
    rmSync(configDir, { recursive: true, force: true })
  })

  test('keeps an allowing safety-net score in the permission decision', async () => {
    globalThis.fetch = mock(async () => Response.json({
      answers: [{ type: 'predicate', name: 'ask', probability: 0.2 }],
    })) as unknown as typeof fetch

    const tool = {
      name: 'Bash',
      inputSchema: z.object({ command: z.string() }),
      checkPermissions: async () => ({
        behavior: 'passthrough' as const,
        message: 'Confirm command',
      }),
    } as unknown as Tool
    let appState = {
      ...getDefaultAppState(),
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode: 'bypassPermissions' as const,
      },
    } as AppState
    const context = {
      abortController: new AbortController(),
      getAppState: () => appState,
      setAppState: (update: (state: AppState) => AppState) => {
        appState = update(appState)
      },
      messages: [],
    } as unknown as ToolUseContext

    const result = await hasPermissionsToUseTool(
      tool,
      { command: 'rm disposable.txt' },
      context,
      {} as AssistantMessage,
      'tool-1',
    )

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'rm disposable.txt' },
      decisionReason: {
        type: 'permissionGuardrail',
        providerId: 'decision-provider',
        modelId: 'decision-model',
        preset: 'safetyNet',
        decision: 'allow',
        score: 0.2,
      },
    })
  })

  test('keeps Bash and PowerShell deny rules ahead of bypass guardrail evaluation', async () => {
    let guardrailRequests = 0
    globalThis.fetch = mock(async () => {
      guardrailRequests += 1
      return Response.json({
        answers: [{ type: 'predicate', name: 'ask', probability: 0 }],
      })
    }) as unknown as typeof fetch

    const inputSchema = z.object({ command: z.string() })
    const tools = [
      {
        name: BASH_TOOL_NAME,
        command:
          'if [ -f "guardrail-deny-rule.txt" ]; then rm guardrail-deny-rule.txt; echo "Deleted guardrail-deny-rule.txt"; else echo "guardrail-deny-rule.txt not found"; fi',
        checkPermissions: bashToolHasPermission,
      },
      {
        name: POWERSHELL_TOOL_NAME,
        command: 'Remove-Item guardrail-deny-rule.txt',
        checkPermissions: powershellToolHasPermission,
      },
    ]
    let appState = {
      ...getDefaultAppState(),
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode: 'bypassPermissions' as const,
        alwaysDenyRules: {
          localSettings: [
            'Bash(*guardrail-deny-rule.txt*)',
            'PowerShell(*guardrail-deny-rule.txt*)',
          ],
        },
      },
    } as AppState
    const context = {
      abortController: new AbortController(),
      getAppState: () => appState,
      setAppState: (update: (state: AppState) => AppState) => {
        appState = update(appState)
      },
      messages: [],
    } as unknown as ToolUseContext

    for (const shellTool of tools) {
      const tool = {
        name: shellTool.name,
        inputSchema,
        checkPermissions: shellTool.checkPermissions,
      } as unknown as Tool
      const result = await hasPermissionsToUseTool(
        tool,
        { command: shellTool.command },
        context,
        {} as AssistantMessage,
        `tool-${shellTool.name}`,
      )

      expect(result.behavior).toBe('deny')
      expect(result.decisionReason).toMatchObject({
        type: 'rule',
        rule: {
          ruleBehavior: 'deny',
          ruleValue: { toolName: shellTool.name },
        },
      })
    }

    expect(guardrailRequests).toBe(0)
  })
})
