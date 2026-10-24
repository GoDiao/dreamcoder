import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ProviderService } from '../services/providerService.js'
import { deriveTitle, generateTitle, parseGeneratedTitleText, saveAiTitle } from '../services/titleService.js'
import { sessionService } from '../services/sessionService.js'

describe('titleService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let originalFetch: typeof globalThis.fetch

  beforeEach(async () => {
    originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
    originalFetch = globalThis.fetch
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'title-service-test-'))
    process.env.DREAMCODER_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    restoreEnv('DREAMCODER_CONFIG_DIR', originalConfigDir)
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('sends disabled thinking for opted-in providers when desktop thinking is off', async () => {
    let requestBody: Record<string, unknown> | null = null
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        requestBody = await req.json() as Record<string, unknown>
        return Response.json({
          type: 'message',
          content: [{ type: 'text', text: '{"title":"Trace ok"}' }],
        })
      },
    })

    try {
      const providerId = 'zhipu-test'
      await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({ alwaysThinkingEnabled: false }, null, 2),
      )
      await fs.writeFile(
        path.join(tmpDir, 'dreamcoder', 'providers.json'),
        JSON.stringify({
          activeId: providerId,
          providers: [
            {
              id: providerId,
              presetId: 'zhipuglm',
              name: 'Zhipu GLM',
              apiKey: 'test-key',
              baseUrl: `http://127.0.0.1:${server.port}/anthropic`,
              apiFormat: 'anthropic',
              models: [{ id: 'glm-5.1' }, { id: 'glm-5-turbo' }, { id: 'glm-4.5-air' }],
              fastModel: 'glm-4.5-air',
            },
          ],
        }, null, 2),
      )

      await expect(generateTitle('请只回复 trace-ok')).resolves.toBe('Trace ok')
      expect(requestBody?.thinking).toEqual({ type: 'disabled' })
      expect(requestBody?.model).toBe('glm-4.5-air')
    } finally {
      server.stop(true)
    }
  })

  test('sends disabled thinking for DeepSeek title generation when desktop thinking is off', async () => {
    let requestBody: Record<string, unknown> | null = null
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        requestBody = await req.json() as Record<string, unknown>
        return Response.json({
          type: 'message',
          content: [{ type: 'text', text: '{"title":"Trace ok"}' }],
        })
      },
    })

    try {
      const providerId = 'deepseek-test'
      await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({ alwaysThinkingEnabled: false }, null, 2),
      )
      await fs.writeFile(
        path.join(tmpDir, 'dreamcoder', 'providers.json'),
        JSON.stringify({
          activeId: providerId,
          providers: [
            {
              id: providerId,
              presetId: 'deepseek',
              name: 'DeepSeek',
              apiKey: 'test-key',
              baseUrl: `http://127.0.0.1:${server.port}/anthropic`,
              apiFormat: 'anthropic',
              models: [{ id: 'deepseek-v4-pro' }],
            },
          ],
        }, null, 2),
      )

      await expect(generateTitle('请只回复 trace-ok')).resolves.toBe('Trace ok')
      expect(requestBody?.thinking).toEqual({ type: 'disabled' })
    } finally {
      server.stop(true)
    }
  })

  test('prefers the fast model for titles and otherwise uses the selected model', async () => {
    const requestedModels: string[] = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const body = await req.json() as { model: string }
        requestedModels.push(body.model)
        return Response.json({
          type: 'message',
          content: [{ type: 'text', text: '{"title":"Trace ok"}' }],
        })
      },
    })

    try {
      const providerService = new ProviderService()
      const provider = await providerService.addProvider({
        presetId: 'custom',
        name: 'Title priority',
        apiKey: 'test-key',
        authStrategy: 'api_key',
        baseUrl: `http://127.0.0.1:${server.port}/anthropic`,
        apiFormat: 'anthropic',
        models: [
          { id: 'list-first' },
          { id: 'selected-model' },
          { id: 'fast-model' },
        ],
      })

      await expect(generateTitle('selected title', provider.id, 'selected-model')).resolves.toBe('Trace ok')
      await providerService.updateProvider(provider.id, { fastModel: 'fast-model' })
      await expect(generateTitle('fast title', provider.id, 'selected-model')).resolves.toBe('Trace ok')

      expect(requestedModels).toEqual(['selected-model', 'fast-model'])
    } finally {
      server.stop(true)
    }
  })

  test('generates titles through the OpenAI Chat format for OpenAI-compatible providers', async () => {
    let requestPath = ''
    let authorization: string | null = null
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        requestPath = new URL(req.url).pathname
        authorization = req.headers.get('authorization')
        return Response.json({
          id: 'chatcmpl-title',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-mini',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: '{"title":"Trace ok"}' },
            finish_reason: 'stop',
          }],
        })
      },
    })

    try {
      const providerId = 'openai-chat-test'
      await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'dreamcoder', 'providers.json'),
        JSON.stringify({
          activeId: providerId,
          providers: [
            {
              id: providerId,
              presetId: 'custom',
              name: 'OpenAI Compatible',
              apiKey: 'test-key',
              baseUrl: `http://127.0.0.1:${server.port}/v1`,
              apiFormat: 'openai_chat',
              models: [{ id: 'gpt-main' }, { id: 'gpt-mini' }],
              fastModel: 'gpt-mini',
            },
          ],
        }, null, 2),
      )

      await expect(generateTitle('请只回复 trace-ok')).resolves.toBe('Trace ok')
      expect(requestPath).toBe('/v1/chat/completions')
      expect(authorization).toBe('Bearer test-key')
    } finally {
      server.stop(true)
    }
  })

  test('derives slash-command titles from command metadata without raw XML tags', () => {
    const raw = [
      '<command-message>frontend-design</command-message>',
      '<command-name>/frontend-design</command-name>',
      '<command-args>@website 重新设计首页</command-args>',
    ].join('\n')

    expect(deriveTitle(raw)).toBe('/frontend-design @website 重新设计首页')
  })

  test('sends cleaned slash-command text to the title model', async () => {
    let requestBody: {
      messages?: Array<{ content?: string }>
    } | null = null
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        requestBody = await req.json() as {
          messages?: Array<{ content?: string }>
        }
        return Response.json({
          type: 'message',
          content: [{ type: 'text', text: '{"title":"Redesign website"}' }],
        })
      },
    })

    try {
      const providerId = 'title-clean-test'
      await fs.mkdir(path.join(tmpDir, 'dreamcoder'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'dreamcoder', 'providers.json'),
        JSON.stringify({
          activeId: providerId,
          providers: [
            {
              id: providerId,
              presetId: 'anthropic',
              name: 'Anthropic',
              apiKey: 'test-key',
              baseUrl: `http://127.0.0.1:${server.port}/anthropic`,
              apiFormat: 'anthropic',
              models: [
                { id: 'claude-sonnet-4-7' },
                { id: 'claude-haiku-4-5' },
                { id: 'claude-opus-4-7' },
              ],
              fastModel: 'claude-haiku-4-5',
            },
          ],
        }, null, 2),
      )

      await expect(generateTitle([
        '<command-message>frontend-design</command-message>',
        '<command-name>/frontend-design</command-name>',
        '<command-args>@website 重新设计首页</command-args>',
      ].join('\n'))).resolves.toBe('Redesign website')

      expect(requestBody?.messages?.[0]?.content).toBe('/frontend-design @website 重新设计首页')
    } finally {
      server.stop(true)
    }
  })

  test('parses JSON title responses wrapped in markdown fences', () => {
    expect(parseGeneratedTitleText('```json\n{"title":"Write bash script"}\n```'))
      .toBe('Write bash script')
  })

  test('parses escaped JSON title responses', () => {
    expect(parseGeneratedTitleText('```json\n{\\"title\\":\\"Write bash script\\"}\n```'))
      .toBe('Write bash script')
  })

  test('rejects incomplete JSON title fragments instead of using them as titles', () => {
    expect(parseGeneratedTitleText('```json\n{\\"title\\":')).toBeNull()
  })

  test('normalizes XML-like title model output before persisting it', () => {
    expect(parseGeneratedTitleText([
      '<command-message>frontend-design</command-message>',
      '<command-name>/frontend-design</command-name>',
      '<command-args>@website</command-args>',
    ].join(' '))).toBe('/frontend-design @website')
  })

  test('does not persist automatic titles over a user custom title', async () => {
    const { sessionId } = await sessionService.createSession(os.tmpdir())
    await sessionService.renameSession(sessionId, 'My fixed name')

    await expect(saveAiTitle(sessionId, 'Automatic topic')).resolves.toBe(false)

    const detail = await sessionService.getSession(sessionId)
    expect(detail?.title).toBe('My fixed name')

    const found = await sessionService.findSessionFile(sessionId)
    expect(found).not.toBeNull()
    const content = await fs.readFile(found!.filePath, 'utf-8')
    expect(content).not.toContain('"type":"ai-title"')
  })
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
