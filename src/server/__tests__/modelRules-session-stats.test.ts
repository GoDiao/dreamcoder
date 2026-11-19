import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { ProviderService } from '../services/providerService.js'
import { SessionService } from '../services/sessionService.js'

let configDir: string
let workDir: string
let originalConfigDir: string | undefined
let originalApiKey: string | undefined

beforeEach(async () => {
  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  originalApiKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'test-key'
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-rules-stats-'))
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-rules-stats-work-'))
  process.env.DREAMCODER_CONFIG_DIR = configDir
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.DREAMCODER_CONFIG_DIR
  else process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalApiKey
  await fs.rm(configDir, { recursive: true, force: true })
  await fs.rm(workDir, { recursive: true, force: true })
})

async function addProviders(): Promise<{ thirdPartyId: string; officialId: string }> {
  const providers = new ProviderService()
  const thirdParty = await providers.addProvider({
    presetId: 'custom',
    name: 'DeepSeek',
    apiKey: 'sk',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiFormat: 'anthropic',
    runtimeKind: 'anthropic_compatible',
    models: [{ id: 'deepseek-v4-pro' }, { id: 'claude-sonnet-4-6' }],
  })
  const official = await providers.addProvider({
    presetId: 'custom',
    name: 'Anthropic',
    apiKey: 'sk',
    baseUrl: 'https://api.anthropic.com',
    apiFormat: 'anthropic',
    runtimeKind: 'anthropic_compatible',
    models: [{ id: 'claude-sonnet-4-6' }],
  })
  await providers.activateProvider(thirdParty.id)
  return { thirdPartyId: thirdParty.id, officialId: official.id }
}

async function sessionWith(entries: Array<Record<string, unknown>>, model: string): Promise<{ svc: SessionService; sessionId: string }> {
  const svc = new SessionService()
  const { sessionId } = await svc.createSession(workDir)
  const found = await svc.findSessionFile(sessionId)
  const assistant = {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: '2026-11-19T00:00:00.000Z',
    cwd: workDir,
    message: {
      role: 'assistant',
      model,
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 100, output_tokens: 20 },
    },
  }
  const lines = [...entries, assistant].map((entry) => JSON.stringify(entry)).join('\n')
  await fs.appendFile(found!.filePath, `${lines}\n`)
  return { svc, sessionId }
}

describe('session stats window and output limit', () => {
  test('a runtime selection with a null provider uses the active provider rules', async () => {
    await addProviders()
    const { svc, sessionId } = await sessionWith(
      [{ type: 'runtime-config', runtime: { providerId: null, modelId: '', effort: 'high' } }],
      'deepseek-v4-pro',
    )

    const usage = await svc.getTranscriptUsage(sessionId)
    const estimate = await svc.getTranscriptContextEstimate(sessionId)

    expect(usage?.models[0]).toMatchObject({ contextWindow: 1048576, maxOutputTokens: 32_000 })
    expect(estimate?.rawMaxTokens).toBe(1048576)
  })

  test('a transcript without a runtime selection uses the active provider rules', async () => {
    await addProviders()
    const { svc, sessionId } = await sessionWith([], 'deepseek-v4-pro')

    const usage = await svc.getTranscriptUsage(sessionId)

    expect(usage?.models[0]).toMatchObject({ contextWindow: 1048576, maxOutputTokens: 32_000 })
  })

  test('the output limit follows the CLI default capped by the model limit', async () => {
    await addProviders()
    const { svc: limited, sessionId: limitedId } = await sessionWith([], 'qwen-max')
    const { svc: unknown, sessionId: unknownId } = await sessionWith([], 'unlisted-model')

    expect((await limited.getTranscriptUsage(limitedId))?.models[0]).toMatchObject({ maxOutputTokens: 8192 })
    expect((await unknown.getTranscriptUsage(unknownId))?.models[0]).toMatchObject({ maxOutputTokens: 32_000 })
  })

  test('an official Anthropic provider keeps the original window lookup', async () => {
    const { officialId } = await addProviders()
    const { svc, sessionId } = await sessionWith(
      [{ type: 'runtime-config', runtime: { providerId: officialId, modelId: 'claude-sonnet-4-6' } }],
      'claude-sonnet-4-6',
    )

    const estimate = await svc.getTranscriptContextEstimate(sessionId)

    expect(estimate?.rawMaxTokens).toBe(200_000)
  })
})
