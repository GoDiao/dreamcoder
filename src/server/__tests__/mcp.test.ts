import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { getOriginalCwd, setCwdState, setOriginalCwd } from '../../bootstrap/state.js'
import * as mcpClient from '../../services/mcp/client.js'
import * as mcpConfig from '../../services/mcp/config.js'
import { _setGlobalConfigCacheForTesting, getProjectPathForConfig } from '../../utils/config.js'
import { getGlobalClaudeFile } from '../../utils/env.js'
import * as mcpHostPreflight from '../services/mcpHostPreflight.js'
import { handleMcpApi } from '../api/mcp.js'
import { conversationService } from '../services/conversationService.js'

let tmpDir: string
let projectRoot: string
let originalConfigDir: string | undefined
let connectSpy: ReturnType<typeof spyOn> | undefined
let getClaudeCodeMcpConfigsSpy: ReturnType<typeof spyOn> | undefined
let getAllMcpConfigsSpy: ReturnType<typeof spyOn> | undefined
let reconnectSpy: ReturnType<typeof spyOn> | undefined
let hostPreflightSpy: ReturnType<typeof spyOn> | undefined
let originalRequestControl: typeof conversationService.requestControl
let originalHasSession: typeof conversationService.hasSession

function clearConfigPathCaches() {
  getGlobalClaudeFile.cache.clear?.()
  getProjectPathForConfig.cache.clear?.()
  _setGlobalConfigCacheForTesting(null)
}

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-mcp-test-'))
  projectRoot = path.join(tmpDir, 'project')
  await fs.mkdir(path.join(projectRoot, '.claude'), { recursive: true })

  originalConfigDir = process.env.DREAMCODER_CONFIG_DIR
  process.env.DREAMCODER_CONFIG_DIR = tmpDir
  clearConfigPathCaches()
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.DREAMCODER_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.DREAMCODER_CONFIG_DIR
  }

  clearConfigPathCaches()
  await fs.rm(tmpDir, { recursive: true, force: true })
}

function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

describe('MCP API', () => {
  beforeEach(async () => {
    await setup()

    hostPreflightSpy = spyOn(mcpHostPreflight, 'inspectMcpHostCommand').mockResolvedValue({
      ok: true,
      resolvedCommand: '/usr/bin/mock-command',
    })
    originalRequestControl = conversationService.requestControl.bind(conversationService)
    originalHasSession = conversationService.hasSession.bind(conversationService)

    connectSpy = spyOn(mcpClient, 'connectToServer').mockImplementation(async (name, config) => ({
      name,
      type: 'connected',
      client: {} as never,
      capabilities: {},
      config,
      cleanup: mock(async () => {}),
    }))
  })

  it('serves the validated curated catalog without reading or changing MCP config', async () => {
    const request = makeRequest('GET', '/api/mcp/catalog')
    const response = await handleMcpApi(request.req, request.url, request.segments)
    expect(response.status).toBe(200)
    const body = await response.json() as { catalog: { version: number; servers: Array<{ id: string }> } }
    expect(body.catalog.version).toBe(1)
    expect(body.catalog.servers.some((server) => server.id === 'filesystem')).toBe(true)
  })

  afterEach(async () => {
    connectSpy?.mockRestore()
    connectSpy = undefined
    getClaudeCodeMcpConfigsSpy?.mockRestore()
    getClaudeCodeMcpConfigsSpy = undefined
    getAllMcpConfigsSpy?.mockRestore()
    getAllMcpConfigsSpy = undefined
    reconnectSpy?.mockRestore()
    reconnectSpy = undefined
    hostPreflightSpy?.mockRestore()
    hostPreflightSpy = undefined
    conversationService.requestControl = originalRequestControl
    conversationService.hasSession = originalHasSession
    await teardown()
  })

  it('writes local MCP config and disabled state to the requested cwd project', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousOriginalCwd = getOriginalCwd()
    const projectA = path.join(tmpDir, 'project-a')
    const projectB = path.join(tmpDir, 'project-b')
    await fs.mkdir(projectA, { recursive: true })
    await fs.mkdir(projectB, { recursive: true })

    process.env.NODE_ENV = 'development'
    clearConfigPathCaches()
    setOriginalCwd(projectA)
    setCwdState(projectA)

    try {
      const create = makeRequest('POST', '/api/mcp', {
        cwd: projectB,
        name: 'scoped-server',
        scope: 'local',
        config: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: {},
        },
      })

      const createRes = await handleMcpApi(create.req, create.url, create.segments)
      expect(createRes.status).toBe(201)

      const disable = makeRequest('POST', '/api/mcp/scoped-server/toggle', {
        cwd: projectB,
      })
      const disableRes = await handleMcpApi(disable.req, disable.url, disable.segments)
      expect(disableRes.status).toBe(200)

      const rawConfig = JSON.parse(
        await fs.readFile(path.join(tmpDir, '.claude.json'), 'utf8'),
      )

      expect(rawConfig.projects?.[projectA]?.mcpServers?.['scoped-server']).toBeUndefined()
      expect(rawConfig.projects?.[projectA]?.disabledMcpServers ?? []).not.toContain('scoped-server')
      expect(rawConfig.projects?.[projectB]?.mcpServers?.['scoped-server']).toMatchObject({
        type: 'stdio',
        command: 'node',
      })
      expect(rawConfig.projects?.[projectB]?.disabledMcpServers).toContain('scoped-server')
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }
      setOriginalCwd(previousOriginalCwd)
      setCwdState(previousOriginalCwd)
      clearConfigPathCaches()
    }
  })

  it('creates and lists local MCP servers for the requested cwd', async () => {
    const create = makeRequest('POST', '/api/mcp', {
      cwd: projectRoot,
      name: 'chrome-devtools',
      scope: 'local',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['chrome-devtools-mcp@latest'],
        env: {
          DEBUG: '1',
        },
      },
    })

    const createRes = await handleMcpApi(create.req, create.url, create.segments)
    expect(createRes.status).toBe(201)
    const createdBody = await createRes.json()
    expect(createdBody.server.name).toBe('chrome-devtools')
    expect(createdBody.server.transport).toBe('stdio')
    expect(createdBody.server.status).toBe('checking')

    const list = makeRequest('GET', `/api/mcp?cwd=${encodeURIComponent(projectRoot)}`)
    const listRes = await handleMcpApi(list.req, list.url, list.segments)
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()

    expect(listBody.servers).toHaveLength(1)
    expect(listBody.servers[0].name).toBe('chrome-devtools')
    expect(listBody.servers[0].status).toBe('checking')
    expect(listBody.servers[0].config.command).toBe('npx')
    expect(connectSpy).not.toHaveBeenCalled()
  })

  describe('confirmed stdio creation', () => {
    const scopes = ['local', 'project', 'user'] as const
    type EditableScope = typeof scopes[number]
    let previousNodeEnv: string | undefined

    beforeEach(() => {
      previousNodeEnv = process.env.NODE_ENV
      // Exercise persisted user config instead of the in-memory test config.
      process.env.NODE_ENV = 'development'
      clearConfigPathCaches()
    })

    afterEach(() => {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }
      clearConfigPathCaches()
    })

    function configFilePath(scope: EditableScope): string {
      return scope === 'project'
        ? path.join(projectRoot, '.mcp.json')
        : getGlobalClaudeFile()
    }

    async function readStoredServers(scope: EditableScope) {
      const stored = JSON.parse(await fs.readFile(configFilePath(scope), 'utf8'))
      return scope === 'local'
        ? stored.projects[projectRoot].mcpServers
        : stored.mcpServers
    }

    function confirmedConfig() {
      const allowedDir = path.join(projectRoot, 'allowed directory')
      return {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@example/reviewed-server@1.2.3', '--directory', allowedDir],
        env: {
          ALLOWED_DIR: allowedDir,
          API_TOKEN: 'fixture-token-only',
        },
      }
    }

    it.each(scopes)('roundtrips the confirmed command, args and env in %s scope', async (scope) => {
      const config = confirmedConfig()
      const create = makeRequest('POST', '/api/mcp', {
        cwd: projectRoot,
        name: 'reviewed-server',
        scope,
        config,
      })

      const createRes = await handleMcpApi(create.req, create.url, create.segments)

      expect(createRes.status).toBe(201)
      await expect(createRes.json()).resolves.toMatchObject({
        server: { name: 'reviewed-server', scope, status: 'checking', config },
      })
      expect(hostPreflightSpy).toHaveBeenCalledWith('npx', projectRoot, config.env)
      expect(await readStoredServers(scope)).toEqual({ 'reviewed-server': config })

      clearConfigPathCaches()
      const list = makeRequest('GET', `/api/mcp?cwd=${encodeURIComponent(projectRoot)}`)
      const listRes = await handleMcpApi(list.req, list.url, list.segments)
      const body = await listRes.json()

      expect(listRes.status).toBe(200)
      expect(body.servers).toHaveLength(1)
      expect(body.servers[0]).toMatchObject({ name: 'reviewed-server', scope, config })
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it.each([
      { args: ['-y', 'pkg@1.2.1'], env: { DEBUG: '1' } },
      { args: ['--token', 'fixture-api-token'], env: { API_TOKEN: 'fixture-api-token' } },
    ])('preserves the command summary and editor config for %j', async ({ args, env }) => {
      const config = { ...confirmedConfig(), args, env }
      const summary = ['npx', ...args].join(' ')
      const create = makeRequest('POST', '/api/mcp', {
        cwd: projectRoot, name: 'reviewed-server', scope: 'project', config,
      })
      const createRes = await handleMcpApi(create.req, create.url, create.segments)
      const createdBody = await createRes.json()

      expect(createRes.status).toBe(201)
      expect(createdBody.server.summary).toBe(summary)
      expect(createdBody.server.config).toEqual(config)
      expect(await readStoredServers('project')).toEqual({ 'reviewed-server': config })

      const list = makeRequest('GET', `/api/mcp?cwd=${encodeURIComponent(projectRoot)}`)
      const listRes = await handleMcpApi(list.req, list.url, list.segments)
      const listBody = await listRes.json()
      expect(listRes.status).toBe(200)
      expect(listBody.servers[0].summary).toBe(summary)
      expect(listBody.servers[0].config).toEqual(config)
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it.each([
      ['project', 'local'],
      ['user', 'local'],
      ['user', 'project'],
      ['local', 'project'],
      ['local', 'user'],
      ['project', 'user'],
    ] as const)('returns the created %s server when %s already has the same name', async (scope, existingScope) => {
      const existingConfig = { ...confirmedConfig(), args: [`fixture-${existingScope}`] }
      const existing = makeRequest('POST', '/api/mcp', {
        cwd: projectRoot,
        name: 'reviewed-server',
        scope: existingScope,
        config: existingConfig,
      })
      const existingRes = await handleMcpApi(existing.req, existing.url, existing.segments)
      expect(existingRes.status).toBe(201)

      const config = { ...confirmedConfig(), args: [`fixture-${scope}`] }
      const create = makeRequest('POST', '/api/mcp', {
        cwd: projectRoot,
        name: 'reviewed-server',
        scope,
        config,
      })
      const createRes = await handleMcpApi(create.req, create.url, create.segments)

      expect(createRes.status).toBe(201)
      await expect(createRes.json()).resolves.toMatchObject({
        server: { name: 'reviewed-server', scope, config },
      })
      expect(await readStoredServers(scope)).toEqual({ 'reviewed-server': config })
      expect(await readStoredServers(existingScope)).toEqual({ 'reviewed-server': existingConfig })

      // Refresh still returns the effective server under the existing scope precedence.
      clearConfigPathCaches()
      const effectiveScope = scopes.indexOf(scope) < scopes.indexOf(existingScope) ? scope : existingScope
      const effectiveConfig = effectiveScope === scope ? config : existingConfig
      const list = makeRequest('GET', `/api/mcp?cwd=${encodeURIComponent(projectRoot)}`)
      const listRes = await handleMcpApi(list.req, list.url, list.segments)
      const listBody = await listRes.json()
      expect(listRes.status).toBe(200)
      expect(listBody.servers).toHaveLength(1)
      expect(listBody.servers[0]).toMatchObject({
        name: 'reviewed-server',
        scope: effectiveScope,
        config: effectiveConfig,
      })
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it.each(scopes)('leaves %s config unchanged when host preflight fails', async (scope) => {
      const config = confirmedConfig()
      const existing = makeRequest('POST', '/api/mcp', {
        cwd: projectRoot,
        name: 'existing-server',
        scope,
        config,
      })
      const existingRes = await handleMcpApi(existing.req, existing.url, existing.segments)
      expect(existingRes.status).toBe(201)
      const before = await fs.readFile(configFilePath(scope), 'utf8')

      hostPreflightSpy?.mockResolvedValueOnce({
        ok: false,
        message: 'Host command "npx" is not available in PATH.',
      })
      const create = makeRequest('POST', '/api/mcp', {
        cwd: projectRoot,
        name: 'reviewed-server',
        scope,
        config,
      })
      const createRes = await handleMcpApi(create.req, create.url, create.segments)

      expect(createRes.status).toBe(400)
      await expect(createRes.json()).resolves.toMatchObject({
        message: 'Host command "npx" is not available in PATH.',
      })
      expect(await fs.readFile(configFilePath(scope), 'utf8')).toBe(before)
      expect(await readStoredServers(scope)).toEqual({ 'existing-server': config })
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it.each(scopes)('preserves the existing %s server on duplicate submission', async (scope) => {
      const config = confirmedConfig()
      const create = makeRequest('POST', '/api/mcp', {
        cwd: projectRoot,
        name: 'reviewed-server',
        scope,
        config,
      })
      const createRes = await handleMcpApi(create.req, create.url, create.segments)
      expect(createRes.status).toBe(201)
      const before = await fs.readFile(configFilePath(scope), 'utf8')

      const duplicate = makeRequest('POST', '/api/mcp', {
        cwd: projectRoot,
        name: 'reviewed-server',
        scope,
        config: { ...config, args: ['different-package'], env: { API_TOKEN: 'different-fixture' } },
      })
      const duplicateRes = await handleMcpApi(duplicate.req, duplicate.url, duplicate.segments)

      expect(duplicateRes.status).toBe(409)
      expect((await duplicateRes.json()).message).toContain('already exists')
      expect(await fs.readFile(configFilePath(scope), 'utf8')).toBe(before)
      expect(await readStoredServers(scope)).toEqual({ 'reviewed-server': config })
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it.each(scopes)('allows one successful %s create after a failed host preflight', async (scope) => {
      const config = confirmedConfig()
      const body = { cwd: projectRoot, name: 'reviewed-server', scope, config }
      hostPreflightSpy?.mockResolvedValueOnce({
        ok: false,
        message: 'Host command "npx" is not available in PATH.',
      })
      const failed = makeRequest('POST', '/api/mcp', body)
      const failedRes = await handleMcpApi(failed.req, failed.url, failed.segments)

      expect(failedRes.status).toBe(400)
      await expect(fs.stat(configFilePath(scope))).rejects.toMatchObject({ code: 'ENOENT' })

      const retry = makeRequest('POST', '/api/mcp', body)
      const retryRes = await handleMcpApi(retry.req, retry.url, retry.segments)

      expect(retryRes.status).toBe(201)
      expect(await readStoredServers(scope)).toEqual({ 'reviewed-server': config })

      const duplicate = makeRequest('POST', '/api/mcp', body)
      const duplicateRes = await handleMcpApi(duplicate.req, duplicate.url, duplicate.segments)

      expect(duplicateRes.status).toBe(409)
      expect(await readStoredServers(scope)).toEqual({ 'reviewed-server': config })
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it('preserves the first payload when project creates arrive concurrently', async () => {
      const config = confirmedConfig()
      const first = makeRequest('POST', '/api/mcp', {
        cwd: projectRoot, name: 'reviewed-server', scope: 'project', config,
      })
      const duplicate = makeRequest('POST', '/api/mcp', {
        cwd: projectRoot,
        name: 'reviewed-server',
        scope: 'project',
        config: { ...config, args: ['different-package'] },
      })

      const [createdRes, duplicateRes] = await Promise.all([
        handleMcpApi(first.req, first.url, first.segments),
        handleMcpApi(duplicate.req, duplicate.url, duplicate.segments),
      ])

      expect(createdRes.status).toBe(201)
      await expect(createdRes.json()).resolves.toMatchObject({
        server: { name: 'reviewed-server', scope: 'project', config },
      })
      expect(duplicateRes.status).toBe(409)
      expect(await readStoredServers('project')).toEqual({ 'reviewed-server': config })
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it('continues queued project creates after preflight and duplicate failures', async () => {
      const config = confirmedConfig()
      const body = { cwd: projectRoot, name: 'reviewed-server', scope: 'project', config }
      hostPreflightSpy?.mockResolvedValueOnce({
        ok: false,
        message: 'Host command "npx" is not available in PATH.',
      })
      const requests = [body, body, body, { ...body, name: 'another-server' }].map(
        (requestBody) => makeRequest('POST', '/api/mcp', requestBody),
      )

      const responses = await Promise.all(requests.map(
        ({ req, url, segments }) => handleMcpApi(req, url, segments),
      ))

      expect(responses.map((response) => response.status)).toEqual([400, 201, 409, 201])
      expect(await readStoredServers('project')).toEqual({
        'reviewed-server': config,
        'another-server': config,
      })
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it('keeps distinct concurrent project creates and their requested cwd', async () => {
      const otherProject = path.join(tmpDir, 'other-project')
      await fs.mkdir(otherProject, { recursive: true })
      const config = confirmedConfig()
      const bodies = [
        { cwd: projectRoot, name: 'first-server', scope: 'project', config },
        { cwd: projectRoot, name: 'second-server', scope: 'project', config },
        { cwd: otherProject, name: 'first-server', scope: 'project', config },
      ]
      const requests = bodies.map((body) => makeRequest('POST', '/api/mcp', body))

      const responses = await Promise.all(requests.map(
        ({ req, url, segments }) => handleMcpApi(req, url, segments),
      ))

      expect(responses.map((response) => response.status)).toEqual([201, 201, 201])
      expect(await readStoredServers('project')).toEqual({
        'first-server': config,
        'second-server': config,
      })
      const otherConfig = JSON.parse(await fs.readFile(path.join(otherProject, '.mcp.json'), 'utf8'))
      expect(otherConfig.mcpServers).toEqual({ 'first-server': config })
      expect(hostPreflightSpy).toHaveBeenNthCalledWith(1, 'npx', projectRoot, config.env)
      expect(hostPreflightSpy).toHaveBeenNthCalledWith(2, 'npx', projectRoot, config.env)
      expect(hostPreflightSpy).toHaveBeenNthCalledWith(3, 'npx', otherProject, config.env)
      expect(connectSpy).not.toHaveBeenCalled()
    })
  })

  it('lists project paths that contain user-private MCP servers', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    const projectB = path.join(tmpDir, 'project-b')
    await fs.mkdir(projectB, { recursive: true })
    process.env.NODE_ENV = 'development'
    clearConfigPathCaches()

    try {
      const create = makeRequest('POST', '/api/mcp', {
        cwd: projectB,
        name: 'private-context7',
        scope: 'local',
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['@upstash/context7-mcp'],
          env: {},
        },
      })
      const createRes = await handleMcpApi(create.req, create.url, create.segments)
      expect(createRes.status).toBe(201)

      const projectPaths = makeRequest('GET', '/api/mcp/project-paths')
      const projectPathsRes = await handleMcpApi(projectPaths.req, projectPaths.url, projectPaths.segments)
      expect(projectPathsRes.status).toBe(200)
      const body = await projectPathsRes.json()

      expect(body.projectPaths).toEqual([projectB])
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }
      clearConfigPathCaches()
    }
  })

  it('updates project MCP servers from their previous cwd into the selected target cwd', async () => {
    const projectA = path.join(tmpDir, 'project-a')
    const projectB = path.join(tmpDir, 'project-b')
    await fs.mkdir(projectA, { recursive: true })
    await fs.mkdir(projectB, { recursive: true })

    const create = makeRequest('POST', '/api/mcp', {
      cwd: projectA,
      name: 'shared-tools',
      scope: 'project',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['old-tools'],
        env: {},
      },
    })
    const createRes = await handleMcpApi(create.req, create.url, create.segments)
    expect(createRes.status).toBe(201)

    const update = makeRequest('PUT', '/api/mcp/shared-tools', {
      cwd: projectB,
      previousCwd: projectA,
      scope: 'project',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['new-tools'],
        env: {},
      },
    })
    const updateRes = await handleMcpApi(update.req, update.url, update.segments)
    expect(updateRes.status).toBe(200)

    const projectAConfig = JSON.parse(await fs.readFile(path.join(projectA, '.mcp.json'), 'utf8'))
    const projectBConfig = JSON.parse(await fs.readFile(path.join(projectB, '.mcp.json'), 'utf8'))

    expect(projectAConfig.mcpServers?.['shared-tools']).toBeUndefined()
    expect(projectBConfig.mcpServers?.['shared-tools']).toMatchObject({
      type: 'stdio',
      command: 'npx',
      args: ['new-tools'],
    })
  })

  it('checks a single server status on demand', async () => {
    const create = makeRequest('POST', '/api/mcp', {
      cwd: projectRoot,
      name: 'deepwiki',
      scope: 'user',
      config: {
        type: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: {},
      },
    })
    await handleMcpApi(create.req, create.url, create.segments)

    const status = makeRequest('GET', `/api/mcp/deepwiki/status?cwd=${encodeURIComponent(projectRoot)}`)
    const statusRes = await handleMcpApi(status.req, status.url, status.segments)

    expect(statusRes.status).toBe(200)
    const body = await statusRes.json()
    expect(body.server.name).toBe('deepwiki')
    expect(body.server.status).toBe('connected')
    expect(connectSpy).toHaveBeenCalled()
  })

  it('lists runtime-visible claude.ai MCP connectors as read-only settings entries', async () => {
    getAllMcpConfigsSpy = spyOn(mcpConfig, 'getAllMcpConfigs').mockResolvedValue({
      servers: {
        'claude.ai Docs': {
          type: 'claudeai-proxy',
          url: 'https://mcp.example.com/docs',
          id: 'srv_docs',
          scope: 'claudeai',
        },
      },
      errors: [],
    })

    const list = makeRequest('GET', `/api/mcp?cwd=${encodeURIComponent(projectRoot)}`)
    const listRes = await handleMcpApi(list.req, list.url, list.segments)

    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()

    expect(listBody.servers).toContainEqual(
      expect.objectContaining({
        name: 'claude.ai Docs',
        scope: 'claudeai',
        transport: 'claudeai-proxy',
        canEdit: false,
        canRemove: false,
      }),
    )
    expect(connectSpy).not.toHaveBeenCalled()
  })

  it('rejects stdio MCP creation when the host command is unavailable', async () => {
    hostPreflightSpy?.mockResolvedValueOnce({
      ok: false,
      message: 'Host command "npx" is not available in PATH.',
    })

    const create = makeRequest('POST', '/api/mcp', {
      cwd: projectRoot,
      name: 'chrome-devtools',
      scope: 'local',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['chrome-devtools-mcp@latest'],
        env: {},
      },
    })

    const createRes = await handleMcpApi(create.req, create.url, create.segments)

    expect(createRes.status).toBe(400)
    await expect(createRes.json()).resolves.toMatchObject({
      message: 'Host command "npx" is not available in PATH.',
    })
  })

  it('surfaces host preflight failures in live status checks without connecting', async () => {
    const create = makeRequest('POST', '/api/mcp', {
      cwd: projectRoot,
      name: 'chrome-devtools',
      scope: 'local',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['chrome-devtools-mcp@latest'],
        env: {},
      },
    })
    await handleMcpApi(create.req, create.url, create.segments)

    hostPreflightSpy?.mockResolvedValueOnce({
      ok: false,
      message: 'Host command "npx" is not available in PATH.',
    })

    const status = makeRequest('GET', `/api/mcp/chrome-devtools/status?cwd=${encodeURIComponent(projectRoot)}`)
    const statusRes = await handleMcpApi(status.req, status.url, status.segments)

    expect(statusRes.status).toBe(200)
    await expect(statusRes.json()).resolves.toMatchObject({
      server: {
        name: 'chrome-devtools',
        status: 'failed',
        statusDetail: 'Host command "npx" is not available in PATH.',
      },
    })
    expect(connectSpy).not.toHaveBeenCalled()
  })

  it('updates, toggles, and deletes MCP servers', async () => {
    const create = makeRequest('POST', '/api/mcp', {
      cwd: projectRoot,
      name: 'context7',
      scope: 'local',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['@upstash/context7-mcp'],
        env: {},
      },
    })
    await handleMcpApi(create.req, create.url, create.segments)

    const update = makeRequest('PUT', '/api/mcp/context7', {
      cwd: projectRoot,
      scope: 'user',
      config: {
        type: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: {
          Authorization: 'Bearer demo',
        },
      },
    })
    const updateRes = await handleMcpApi(update.req, update.url, update.segments)
    expect(updateRes.status).toBe(200)
    const updatedBody = await updateRes.json()
    expect(updatedBody.server.transport).toBe('http')
    expect(updatedBody.server.scope).toBe('user')

    const disable = makeRequest('POST', '/api/mcp/context7/toggle', { cwd: projectRoot })
    const disableRes = await handleMcpApi(disable.req, disable.url, disable.segments)
    expect(disableRes.status).toBe(200)
    const disabledBody = await disableRes.json()
    expect(disabledBody.server.enabled).toBe(false)
    expect(disabledBody.server.status).toBe('disabled')

    const enable = makeRequest('POST', '/api/mcp/context7/toggle', { cwd: projectRoot })
    const enableRes = await handleMcpApi(enable.req, enable.url, enable.segments)
    expect(enableRes.status).toBe(200)
    const enabledBody = await enableRes.json()
    expect(enabledBody.server.enabled).toBe(true)

    const remove = makeRequest('DELETE', `/api/mcp/context7?scope=user&cwd=${encodeURIComponent(projectRoot)}`)
    const removeRes = await handleMcpApi(remove.req, remove.url, remove.segments)
    expect(removeRes.status).toBe(200)

    const list = makeRequest('GET', `/api/mcp?cwd=${encodeURIComponent(projectRoot)}`)
    const listRes = await handleMcpApi(list.req, list.url, list.segments)
    const listBody = await listRes.json()
    expect(listBody.servers.some((server: { name: string }) => server.name === 'context7')).toBe(false)
  })

  it('syncs MCP toggles into the active CLI session control channel', async () => {
    const create = makeRequest('POST', '/api/mcp', {
      cwd: projectRoot,
      name: 'session-sync',
      scope: 'local',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['session-sync-mcp'],
        env: {},
      },
    })
    await handleMcpApi(create.req, create.url, create.segments)

    const requestControl = mock(async () => ({}))
    conversationService.hasSession = ((sessionId: string) => sessionId === 'session-1') as typeof conversationService.hasSession
    conversationService.requestControl = requestControl as typeof conversationService.requestControl

    const disable = makeRequest('POST', '/api/mcp/session-sync/toggle', {
      cwd: projectRoot,
      sessionId: 'session-1',
    })
    const disableRes = await handleMcpApi(disable.req, disable.url, disable.segments)

    expect(disableRes.status).toBe(200)
    expect(requestControl).toHaveBeenCalledWith(
      'session-1',
      { subtype: 'mcp_toggle', serverName: 'session-sync', enabled: false },
      120_000,
    )
  })

  it('reconnects plugin-scoped MCP servers exposed via the merged server list', async () => {
    const pluginServerName = 'plugin:telegram:telegram'
    const pluginServerConfig = {
      scope: 'dynamic',
      type: 'stdio',
      command: 'bun',
      args: ['run', 'start'],
      env: {
        CLAUDE_PLUGIN_ROOT: '/tmp/telegram-plugin',
      },
      pluginSource: 'telegram@claude-plugins-official',
    } as const

    getClaudeCodeMcpConfigsSpy = spyOn(mcpConfig, 'getClaudeCodeMcpConfigs').mockResolvedValue({
      servers: {
        [pluginServerName]: pluginServerConfig,
      },
      errors: [],
    })

    reconnectSpy = spyOn(mcpClient, 'reconnectMcpServerImpl').mockResolvedValue({
      name: pluginServerName,
      client: {
        name: pluginServerName,
        type: 'connected',
        client: {} as never,
        capabilities: {},
        config: pluginServerConfig,
        cleanup: mock(async () => {}),
      },
    })

    const reconnect = makeRequest('POST', `/api/mcp/${encodeURIComponent(pluginServerName)}/reconnect`, {
      cwd: projectRoot,
    })
    const reconnectRes = await handleMcpApi(reconnect.req, reconnect.url, reconnect.segments)

    expect(reconnectRes.status).toBe(200)
    expect(reconnectSpy).toHaveBeenCalledWith(pluginServerName, pluginServerConfig)

    const body = await reconnectRes.json()
    expect(body.server.name).toBe(pluginServerName)
    expect(body.server.scope).toBe('dynamic')
  })

  it('returns a failed server state when reconnect preflight fails on the host machine', async () => {
    const pluginServerName = 'plugin:telegram:telegram'
    const pluginServerConfig = {
      scope: 'dynamic',
      type: 'stdio',
      command: 'npx',
      args: ['telegram-mcp'],
      env: {},
      pluginSource: 'telegram@claude-plugins-official',
    } as const

    getClaudeCodeMcpConfigsSpy = spyOn(mcpConfig, 'getClaudeCodeMcpConfigs').mockResolvedValue({
      servers: {
        [pluginServerName]: pluginServerConfig,
      },
      errors: [],
    })

    hostPreflightSpy?.mockResolvedValueOnce({
      ok: false,
      message: 'Host command "npx" is not available in PATH.',
    })

    reconnectSpy = spyOn(mcpClient, 'reconnectMcpServerImpl').mockResolvedValue({
      name: pluginServerName,
      client: {
        name: pluginServerName,
        type: 'connected',
        client: {} as never,
        capabilities: {},
        config: pluginServerConfig,
        cleanup: mock(async () => {}),
      },
    })

    const reconnect = makeRequest('POST', `/api/mcp/${encodeURIComponent(pluginServerName)}/reconnect`, {
      cwd: projectRoot,
    })
    const reconnectRes = await handleMcpApi(reconnect.req, reconnect.url, reconnect.segments)

    expect(reconnectRes.status).toBe(200)
    expect(reconnectSpy).not.toHaveBeenCalled()
    await expect(reconnectRes.json()).resolves.toMatchObject({
      server: {
        name: pluginServerName,
        status: 'failed',
        statusDetail: 'Host command "npx" is not available in PATH.',
      },
    })
  })
})
