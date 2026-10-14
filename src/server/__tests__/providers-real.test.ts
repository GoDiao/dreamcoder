import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ProviderService } from '../services/providerService.js'

const MODEL_MAPPING = {
  main: 'MiniMax-M2.7-highspeed',
  haiku: 'MiniMax-M2.7-highspeed',
  sonnet: 'MiniMax-M2.7-highspeed',
  opus: 'MiniMax-M2.7-highspeed',
}

describe('Real Provider Configs', () => {
  let tmpDir: string
  let service: ProviderService

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-real-'))
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    service = new ProviderService()
  })

  afterEach(async () => {
    delete process.env.CLAUDE_CONFIG_DIR
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function readCcHahaSettings(): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(path.join(tmpDir, 'dreamcoder', 'settings.json'), 'utf-8')
    return JSON.parse(raw)
  }

  async function originalSettingsExists(): Promise<boolean> {
    try {
      await fs.access(path.join(tmpDir, 'settings.json'))
      return true
    } catch {
      return false
    }
  }

  test('添加 MiniMax Provider 并激活 — 写入 dreamcoder/settings.json', async () => {
    const minimax = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-fake-test-key-for-testing-only',
      models: MODEL_MAPPING,
      notes: 'MiniMax 官方 Anthropic 兼容接口',
    })

    expect(minimax.name).toBe('MiniMax')

    await service.activateProvider(minimax.id)

    const settings = await readCcHahaSettings()
    expect((settings.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect((settings.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe('sk-fake-test-key-for-testing-only')
    expect((settings.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('')
    expect((settings.env as Record<string, string>).ANTHROPIC_MODEL).toBe('MiniMax-M2.7-highspeed')
    expect(JSON.parse((settings.env as Record<string, string>).CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toMatchObject({
      'MiniMax-M2.7': 204800,
      'MiniMax-M2.7-highspeed': 204800,
    })

    expect(await originalSettingsExists()).toBe(false)

    console.log('✅ Provider 写入 dreamcoder/settings.json，原版 settings.json 未被污染')
  })

  test('切换 Provider — 更新 dreamcoder/settings.json', async () => {
    const minimax = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-api-test-minimax',
      models: MODEL_MAPPING,
    })

    const jiekou = await service.addProvider({
      presetId: 'custom',
      name: '接口AI中转站',
      baseUrl: 'https://api.jiekou.ai/anthropic',
      apiKey: 'sk-fake-test-key-for-testing-only',
      models: {
        main: 'claude-opus-4-7',
        haiku: 'claude-haiku-4-5',
        sonnet: 'claude-sonnet-4-6',
        opus: 'claude-opus-4-7',
      },
    })

    await service.activateProvider(minimax.id)
    let settings = await readCcHahaSettings()
    expect((settings.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect(JSON.parse((settings.env as Record<string, string>).CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toMatchObject({
      'MiniMax-M2.7': 204800,
      'MiniMax-M2.7-highspeed': 204800,
    })

    await service.activateProvider(jiekou.id)
    settings = await readCcHahaSettings()
    expect((settings.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://api.jiekou.ai/anthropic')
    expect((settings.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe('sk-fake-test-key-for-testing-only')
    expect((settings.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('')
    expect((settings.env as Record<string, string>).ANTHROPIC_MODEL).toBe('claude-opus-4-7')
    expect((settings.env as Record<string, string>).CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()

    const list = await service.listProviders()
    expect(list.activeId).toBe(jiekou.id)

    expect(await originalSettingsExists()).toBe(false)

    console.log('✅ 切换 Provider 成功，dreamcoder/settings.json 更新正确')
  })

  test('dreamcoder/settings.json 保留已有字段', async () => {
    await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'dreamcoder', 'settings.json'),
      JSON.stringify({
        customField: 'should_be_preserved',
        env: {
          EXISTING_VAR: 'should_be_preserved',
        },
      }, null, 2),
    )

    const provider = await service.addProvider({
      presetId: 'custom',
      name: '接口AI中转站',
      baseUrl: 'https://api.jiekou.ai/anthropic',
      apiKey: 'sk_test',
      models: {
        main: 'claude-opus-4-7',
        haiku: 'claude-haiku-4-5',
        sonnet: 'claude-sonnet-4-6',
        opus: 'claude-opus-4-7',
      },
    })
    await service.activateProvider(provider.id)

    const settings = await readCcHahaSettings()

    expect((settings.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://api.jiekou.ai/anthropic')
    expect((settings.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe('sk_test')
    expect((settings.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('')

    expect(settings.customField).toBe('should_be_preserved')
    expect((settings.env as Record<string, string>).EXISTING_VAR).toBe('should_be_preserved')

    console.log('✅ dreamcoder/settings.json 已有字段全部保留')
  })

  test('activateOfficial 清除 provider env', async () => {
    const provider = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-test',
      models: MODEL_MAPPING,
    })

    await service.activateProvider(provider.id)

    let settings = await readCcHahaSettings()
    expect((settings.env as Record<string, string>).ANTHROPIC_BASE_URL).toBeDefined()

    await service.activateOfficial()

    settings = await readCcHahaSettings()
    const env = settings.env as Record<string, string> | undefined
    expect(env?.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env?.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env?.ANTHROPIC_MODEL).toBeUndefined()

    console.log('✅ activateOfficial 正确清除了 provider env')
  })

  test('连通性测试 — 返回结构正确', async () => {
    const result = await service.testProviderConfig({
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-fake-test-key',
      modelId: 'MiniMax-M2.7-highspeed',
      authStrategy: 'auth_token',
    })

    expect(result.connectivity).toBeDefined()
    expect(result.connectivity.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.connectivity.modelUsed).toBe('MiniMax-M2.7-highspeed')

    console.log('🔌 MiniMax 连通性测试结果:')
    console.log('   success:', result.connectivity.success)
    console.log('   latencyMs:', result.connectivity.latencyMs)
    console.log('   error:', result.connectivity.error)
  })

  test('providers.json 和 dreamcoder/settings.json 独立于 settings.json', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        effortLevel: 'high',
        env: {
          ANTHROPIC_BASE_URL: 'https://original-claude-code.api.com',
          ANTHROPIC_API_KEY: 'original-key',
        },
      }, null, 2),
    )

    const provider = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-haha-key',
      models: MODEL_MAPPING,
    })
    await service.activateProvider(provider.id)

    const original = JSON.parse(await fs.readFile(path.join(tmpDir, 'settings.json'), 'utf-8'))
    expect((original.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://original-claude-code.api.com')
    expect((original.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('original-key')
    expect(original.effortLevel).toBe('high')

    const haha = await readCcHahaSettings()
    expect((haha.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect((haha.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe('sk-haha-key')
    expect((haha.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('')

    console.log('✅ 原版 settings.json 完好无损，Haha 配置独立存储')
  })
})
