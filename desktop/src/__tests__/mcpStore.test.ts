import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mcpApi } from '../api/mcp'
import { useMcpStore } from '../stores/mcpStore'
import type { McpServerRecord, McpUpsertPayload } from '../types/mcp'

vi.mock('../api/mcp', () => ({
  mcpApi: {
    list: vi.fn(),
    create: vi.fn(),
    status: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

const mockedMcpApi = vi.mocked(mcpApi)
const initialState = useMcpStore.getInitialState()
const projectA = '/workspace/project-a'
const projectB = '/workspace/project-b'

function server(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    name: 'filesystem',
    scope: 'local',
    transport: 'stdio',
    enabled: true,
    status: 'checking',
    statusLabel: 'Checking',
    configLocation: 'test configuration',
    summary: 'Fixture MCP server',
    canEdit: true,
    canRemove: true,
    canReconnect: true,
    canToggle: true,
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@example/filesystem@1.0.0', '/workspace/allowed directory'],
      env: { EXAMPLE_TOKEN: 'test-only-token' },
    },
    ...overrides,
  }
}

describe('mcpStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useMcpStore.setState(initialState, true)
  })

  it.each(['local', 'project', 'user'] as const)(
    'creates a %s server with the requested config and normalized project identity',
    async (scope) => {
      const existing = server({ name: 'existing', projectPath: projectA })
      const responseServer = server({ scope, projectPath: '/workspace/stale-path' })
      const payload: McpUpsertPayload = { scope, config: responseServer.config }
      useMcpStore.setState({ servers: [existing], selectedServer: existing, error: 'Previous load failed' })
      mockedMcpApi.create.mockResolvedValue({ server: responseServer })

      const created = await useMcpStore.getState().createServer(responseServer.name, payload, projectB)

      expect(mockedMcpApi.create).toHaveBeenCalledExactlyOnceWith(responseServer.name, payload, projectB)
      expect(created).toEqual({ ...responseServer, projectPath: scope === 'user' ? undefined : projectB })
      expect(useMcpStore.getState().servers).toEqual([existing, created])
      expect(useMcpStore.getState().selectedServer).toBe(created)
      expect(useMcpStore.getState().error).toBeNull()
      expect(responseServer.projectPath).toBe('/workspace/stale-path')
    },
  )

  it.each(['local', 'project'] as const)(
    'preserves a %s server response project when create has no explicit cwd',
    async (scope) => {
      const responseServer = server({ scope, projectPath: projectA })
      mockedMcpApi.create.mockResolvedValue({ server: responseServer })

      const created = await useMcpStore.getState().createServer(responseServer.name, {
        scope,
        config: responseServer.config,
      })

      expect(created.projectPath).toBe(projectA)
      expect(useMcpStore.getState().selectedServer).toBe(created)
    },
  )

  it('keeps installed state unchanged until create succeeds', async () => {
    const existing = server({ name: 'existing', projectPath: projectA })
    const responseServer = server()
    let resolveCreate!: (value: { server: McpServerRecord }) => void
    mockedMcpApi.create.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve }))
    useMcpStore.setState({ servers: [existing], selectedServer: existing })

    const creation = useMcpStore.getState().createServer(responseServer.name, {
      scope: 'local',
      config: responseServer.config,
    }, projectB)

    expect(useMcpStore.getState().servers).toEqual([existing])
    expect(useMcpStore.getState().selectedServer).toBe(existing)

    resolveCreate({ server: responseServer })
    const created = await creation

    expect(useMcpStore.getState().servers).toEqual([existing, created])
    expect(useMcpStore.getState().selectedServer).toBe(created)
  })

  it('propagates a rejected create without replacing installed or selected servers, then allows retry', async () => {
    const existing = server({ name: 'existing', projectPath: projectA })
    const responseServer = server()
    const payload: McpUpsertPayload = { scope: 'local', config: responseServer.config }
    const failure = new Error('MCP server already exists')
    mockedMcpApi.create.mockRejectedValueOnce(failure).mockResolvedValueOnce({ server: responseServer })
    useMcpStore.setState({ servers: [existing], selectedServer: existing })

    await expect(useMcpStore.getState().createServer(responseServer.name, payload, projectB)).rejects.toBe(failure)

    expect(useMcpStore.getState().servers).toEqual([existing])
    expect(useMcpStore.getState().selectedServer).toBe(existing)

    const created = await useMcpStore.getState().createServer(responseServer.name, payload, projectB)

    expect(mockedMcpApi.create).toHaveBeenCalledTimes(2)
    expect(useMcpStore.getState().servers).toEqual([existing, created])
    expect(useMcpStore.getState().selectedServer).toBe(created)
  })

  it.each(['local', 'project'] as const)(
    'keeps same-name %s servers in separate projects distinct when creating, updating, and deleting',
    async (scope) => {
      const existing = server({ scope, projectPath: projectA })
      const responseServer = server({ scope })
      const payload: McpUpsertPayload = { scope, config: responseServer.config }
      useMcpStore.setState({ servers: [existing], selectedServer: existing })
      mockedMcpApi.create.mockResolvedValue({ server: responseServer })

      const created = await useMcpStore.getState().createServer(responseServer.name, payload, projectB)
      expect(useMcpStore.getState().servers).toEqual([existing, created])

      useMcpStore.getState().selectServer(existing)
      mockedMcpApi.update.mockResolvedValue({ server: { ...responseServer, summary: 'Updated project B' } })
      const updated = await useMcpStore.getState().updateServer(created, payload, projectB)

      expect(mockedMcpApi.update).toHaveBeenCalledExactlyOnceWith(created.name, payload, projectB, projectB)
      expect(useMcpStore.getState().servers).toEqual([existing, updated])
      expect(useMcpStore.getState().selectedServer).toBe(existing)

      mockedMcpApi.remove.mockResolvedValue({ ok: true })
      await useMcpStore.getState().deleteServer(updated, projectB)

      expect(mockedMcpApi.remove).toHaveBeenCalledExactlyOnceWith(updated.name, scope, projectB)
      expect(useMcpStore.getState().servers).toEqual([existing])
      expect(useMcpStore.getState().selectedServer).toBe(existing)
    },
  )

  it('refreshes installed servers across projects while deduplicating user and other global records', async () => {
    const local = server({ scope: 'local' })
    const project = server({ scope: 'project' })
    const user = server({ scope: 'user', projectPath: '/workspace/stale-path' })
    const global = server({ scope: 'enterprise', projectPath: '/workspace/stale-path' })
    useMcpStore.setState({ servers: [server({ name: 'removed-server' })], error: 'Previous load failed' })
    mockedMcpApi.list.mockResolvedValue({ servers: [local, project, user, global] })

    await useMcpStore.getState().fetchServers([projectA, '', projectB, projectA], '/workspace/unused-fallback')

    expect(mockedMcpApi.list.mock.calls).toEqual([[projectA], [projectB]])
    expect(useMcpStore.getState().servers).toEqual([
      { ...local, projectPath: projectA },
      { ...project, projectPath: projectA },
      { ...user, projectPath: undefined },
      { ...global, projectPath: undefined },
      { ...local, projectPath: projectB },
      { ...project, projectPath: projectB },
    ])
    expect(useMcpStore.getState().isLoading).toBe(false)
    expect(useMcpStore.getState().error).toBeNull()
  })

  it.each([
    { paths: undefined, fallback: undefined, expectedCwd: undefined },
    { paths: ['', ''], fallback: projectA, expectedCwd: projectA },
  ])('refreshes using fallback context $expectedCwd when no project paths are available', async ({ paths, fallback, expectedCwd }) => {
    const user = server({ scope: 'user' })
    mockedMcpApi.list.mockResolvedValue({ servers: [user] })

    await useMcpStore.getState().fetchServers(paths, fallback)

    expect(mockedMcpApi.list).toHaveBeenCalledExactlyOnceWith(expectedCwd)
    expect(useMcpStore.getState().servers).toEqual([{ ...user, projectPath: undefined }])
  })

  it('retains installed records after a failed refresh and clears the error on retry', async () => {
    const existing = server({ projectPath: projectA })
    const refreshed = server({ status: 'connected', statusLabel: 'Connected' })
    useMcpStore.setState({ servers: [existing], selectedServer: existing })
    mockedMcpApi.list.mockRejectedValueOnce(new Error('Server unavailable')).mockResolvedValueOnce({ servers: [refreshed] })

    await useMcpStore.getState().fetchServers([projectA])

    expect(useMcpStore.getState().servers).toEqual([existing])
    expect(useMcpStore.getState().selectedServer).toBe(existing)
    expect(useMcpStore.getState().isLoading).toBe(false)
    expect(useMcpStore.getState().error).toBe('Server unavailable')

    await useMcpStore.getState().fetchServers([projectA])

    expect(useMcpStore.getState().servers).toEqual([{ ...refreshed, projectPath: projectA }])
    expect(useMcpStore.getState().isLoading).toBe(false)
    expect(useMcpStore.getState().error).toBeNull()
  })

  it.each([
    { requestedScope: 'user', responseScope: 'local', responseName: 'filesystem' },
    { requestedScope: 'project', responseScope: 'local', responseName: 'filesystem' },
    { requestedScope: 'local', responseScope: 'user', responseName: 'filesystem' },
    { requestedScope: 'local', responseScope: 'local', responseName: 'another-server' },
  ])(
    'ignores a status response for $responseScope/$responseName when refreshing $requestedScope/filesystem',
    async ({ requestedScope, responseScope, responseName }) => {
      const requested = server({ scope: requestedScope, projectPath: requestedScope === 'user' ? undefined : projectA })
      const otherProject = server({ projectPath: projectB })
      useMcpStore.setState({ servers: [requested, otherProject], selectedServer: requested })
      const previousState = useMcpStore.getState()
      mockedMcpApi.status.mockResolvedValue({
        server: server({ name: responseName, scope: responseScope, status: 'connected', statusLabel: 'Connected' }),
      })

      const refreshed = await useMcpStore.getState().refreshServerStatus(requested, projectA)

      expect(mockedMcpApi.status).toHaveBeenCalledExactlyOnceWith(requested.name, projectA)
      expect(refreshed).toBe(requested)
      expect(useMcpStore.getState()).toBe(previousState)
    },
  )

  it('does not append a different-scope status response after a list refresh has removed the requested record', async () => {
    const requested = server({ scope: 'user' })
    const replacement = server({ scope: 'local', projectPath: projectA })
    let resolveStatus!: (value: { server: McpServerRecord }) => void
    mockedMcpApi.status.mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve }))
    useMcpStore.setState({ servers: [requested], selectedServer: requested })

    const refresh = useMcpStore.getState().refreshServerStatus(requested, projectA)
    mockedMcpApi.list.mockResolvedValue({ servers: [replacement] })
    await useMcpStore.getState().fetchServers([projectA])
    const stateAfterListRefresh = useMcpStore.getState()
    resolveStatus({ server: replacement })

    expect(await refresh).toBe(requested)
    expect(useMcpStore.getState()).toBe(stateAfterListRefresh)
    expect(useMcpStore.getState().servers).toEqual([replacement])
  })

  it.each(['local', 'project', 'user'] as const)(
    'updates status for the same %s record while preserving its project identity',
    async (scope) => {
      const requested = server({ scope, projectPath: scope === 'user' ? undefined : projectA })
      const responseServer = server({ scope, status: 'connected', statusLabel: 'Connected' })
      useMcpStore.setState({ servers: [requested], selectedServer: requested })
      mockedMcpApi.status.mockResolvedValue({ server: responseServer })

      const refreshed = await useMcpStore.getState().refreshServerStatus(requested, projectA)

      expect(refreshed).toEqual({ ...responseServer, projectPath: scope === 'user' ? undefined : projectA })
      expect(useMcpStore.getState().servers).toEqual([refreshed])
      expect(useMcpStore.getState().selectedServer).toBe(refreshed)
    },
  )
})
