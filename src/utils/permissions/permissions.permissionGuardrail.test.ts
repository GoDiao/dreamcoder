import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import type { Tool, ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import { bashToolHasPermission } from '../../tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { powershellToolHasPermission } from '../../tools/PowerShellTool/powershellPermissions.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import type { AssistantMessage } from '../../types/message.js'
import type { PermissionMode } from '../../types/permissions.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { initializeToolPermissionContext } from './permissionSetup.js'
import { hasPermissionsToUseTool } from './permissions.js'

describe('Auto permission pipeline', () => {
  let configDir: string
  let originalConfigDir: string | undefined
  let originalCwd: string
  let originalFetch: typeof fetch

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'auto-permission-'))
    originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
    originalCwd = getOriginalCwd()
    originalFetch = globalThis.fetch
    process.env.DREAMCODER_CONFIG_DIR = configDir
    mkdirSync(join(configDir, 'dreamcoder'), { recursive: true })
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify({
      autoPermission: {
        providerId: 'decision-provider',
        modelId: 'gpt-6-luna',
        privacyNoticeVersion: 1,
      },
    }))
    writeFileSync(join(configDir, 'dreamcoder', 'providers.json'), JSON.stringify({
      activeId: null,
      providers: [],
      decisionProviders: [{
        id: 'decision-provider',
        presetId: 'openai',
        name: 'OpenAI Decisions',
        deployment: 'hosted',
        apiFormat: 'openai_decisions',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-placeholder',
        models: [{ id: 'gpt-6-luna' }],
      }],
    }))
    resetSettingsCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
    else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
    setOriginalCwd(originalCwd)
    resetSettingsCache()
    rmSync(configDir, { recursive: true, force: true })
  })

  function context(
    mode: PermissionMode,
    denyRules: string[] = [],
    loadedContext?: ToolPermissionContext,
  ): ToolUseContext {
    let appState = {
      ...getDefaultAppState(),
      toolPermissionContext: loadedContext ?? {
        ...getEmptyToolPermissionContext(),
        mode,
        alwaysDenyRules: denyRules.length > 0 ? { localSettings: denyRules } : {},
      },
    } as AppState
    return {
      abortController: new AbortController(),
      getAppState: () => appState,
      setAppState: (update: (state: AppState) => AppState) => {
        appState = update(appState)
      },
      messages: [],
    } as unknown as ToolUseContext
  }

  function unresolvedTool(): Tool {
    return {
      name: BASH_TOOL_NAME,
      inputSchema: z.object({ command: z.string() }),
      checkPermissions: async () => ({
        behavior: 'passthrough' as const,
        message: 'Confirm command',
      }),
    } as unknown as Tool
  }

  test('auto-allows an unresolved prompt below the fixed policy threshold', async () => {
    globalThis.fetch = mock(async () => Response.json({
      answers: [{ type: 'predicate', name: 'ask', probability: 0.49 }],
    })) as unknown as typeof fetch

    const result = await hasPermissionsToUseTool(
      unresolvedTool(),
      { command: 'ls' },
      context('auto'),
      {} as AssistantMessage,
      'tool-1',
    )

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'ls' },
      decisionReason: {
        type: 'autoPermission',
        providerId: 'decision-provider',
        modelId: 'gpt-6-luna',
        source: 'decisionProvider',
        decision: 'allow',
        score: 0.49,
        policyVersion: 1,
        reason: undefined,
      },
    })
  })

  test('keeps threshold, errors, and malformed responses as confirmation', async () => {
    for (const response of [
      Response.json({ answers: [{ type: 'predicate', name: 'ask', probability: 0.5 }] }),
      Response.json({ answers: [] }),
      new Response('failure', { status: 500 }),
    ]) {
      globalThis.fetch = mock(async () => response) as unknown as typeof fetch
      const result = await hasPermissionsToUseTool(
        unresolvedTool(),
        { command: 'rm file.txt' },
        context('auto'),
        {} as AssistantMessage,
        'tool-ask',
      )
      expect(result.behavior).toBe('ask')
      expect(result.decisionReason).toMatchObject({
        type: 'autoPermission',
        decision: 'ask',
        policyVersion: 1,
      })
    }
  })

  test('does not invoke a decision model outside Auto mode', async () => {
    let requests = 0
    globalThis.fetch = mock(async () => {
      requests += 1
      return Response.json({
        answers: [{ type: 'predicate', name: 'ask', probability: 0 }],
      })
    }) as unknown as typeof fetch

    for (const mode of ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const) {
      await hasPermissionsToUseTool(
        unresolvedTool(),
        { command: 'ls' },
        context(mode),
        {} as AssistantMessage,
        `tool-${mode}`,
      )
    }

    expect(requests).toBe(0)
  })

  test.each([
    [BASH_TOOL_NAME, 'rm guardrail-deny-rule.txt', bashToolHasPermission],
    [POWERSHELL_TOOL_NAME, 'Remove-Item guardrail-deny-rule.txt', powershellToolHasPermission],
  ] as const)('keeps %s deny rules ahead of Auto and bypass', async (name, command, checkPermissions) => {
    let requests = 0
    globalThis.fetch = mock(async () => {
      requests += 1
      return Response.json({
        answers: [{ type: 'predicate', name: 'ask', probability: 0 }],
      })
    }) as unknown as typeof fetch

    const inputSchema = z.object({ command: z.string() })
    const denyRules = [
      'Bash(*guardrail-deny-rule.txt*)',
      'PowerShell(*guardrail-deny-rule.txt*)',
    ]

    for (const mode of ['auto', 'bypassPermissions'] as const) {
      const tool = { name, inputSchema, checkPermissions } as unknown as Tool
      const result = await hasPermissionsToUseTool(
        tool,
        { command },
        context(mode, denyRules),
        {} as AssistantMessage,
        `tool-${mode}-${name}`,
      )

      expect(result.behavior).toBe('deny')
      expect(result.decisionReason).toMatchObject({
        type: 'rule',
        rule: {
          ruleBehavior: 'deny',
          ruleValue: { toolName: name },
        },
      })
    }

    expect(requests).toBe(0)
  })

  test('loads Bash and PowerShell deny rules from project local settings', async () => {
    const projectDir = join(configDir, 'project')
    mkdirSync(join(projectDir, '.claude'), { recursive: true })
    writeFileSync(join(projectDir, '.claude', 'settings.local.json'), JSON.stringify({
      permissions: {
        deny: [
          'Bash(*guardrail-hard-deny.txt*)',
          'PowerShell(*guardrail-hard-deny.txt*)',
        ],
      },
    }))
    setOriginalCwd(projectDir)
    resetSettingsCache()

    const initialized = await initializeToolPermissionContext({
      allowedToolsCli: [],
      disallowedToolsCli: [],
      permissionMode: 'auto',
      allowDangerouslySkipPermissions: false,
      addDirs: [],
    })
    const shellTools = [
      {
        name: BASH_TOOL_NAME,
        command: 'rm guardrail-hard-deny.txt',
        checkPermissions: bashToolHasPermission,
      },
      {
        name: POWERSHELL_TOOL_NAME,
        command: 'Remove-Item guardrail-hard-deny.txt',
        checkPermissions: powershellToolHasPermission,
      },
    ]

    for (const shellTool of shellTools) {
      const result = await hasPermissionsToUseTool(
        {
          name: shellTool.name,
          inputSchema: z.object({ command: z.string() }),
          checkPermissions: shellTool.checkPermissions,
        } as unknown as Tool,
        { command: shellTool.command },
        context('auto', [], initialized.toolPermissionContext),
        {} as AssistantMessage,
        `tool-loaded-${shellTool.name}`,
      )

      expect(result.behavior).toBe('deny')
      expect(result.decisionReason).toMatchObject({
        type: 'rule',
        rule: {
          source: 'localSettings',
          ruleBehavior: 'deny',
          ruleValue: { toolName: shellTool.name },
        },
      })
    }
  })
})
