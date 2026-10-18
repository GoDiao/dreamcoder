import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ApiError } from '../api/client'
import { mcpApi } from '../api/mcp'
import { sessionsApi } from '../api/sessions'
import { McpSettings } from '../pages/McpSettings'
import { useMcpStore } from '../stores/mcpStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { McpCatalogEntry, McpServerRecord, McpWritableScope } from '../types/mcp'

vi.mock('../api/mcp', () => ({
  mcpApi: {
    list: vi.fn(),
    projectPaths: vi.fn(),
    catalog: vi.fn(),
    status: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
    reconnect: vi.fn(),
  },
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: { getRecentProjects: vi.fn() },
}))

// Folder navigation has its own tests. This controlled picker also exercises
// choosing a project absent from the page's initially discovered project list.
vi.mock('../components/shared/DirectoryPicker', () => ({
  DirectoryPicker: ({ value, onChange }: { value: string; onChange: (path: string) => void }) => (
    <label>
      Project folder
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
}))

const currentProject = '/workspace/current-project'
const configuredProject = '/workspace/configured-project'
const newProject = '/workspace/new-project'
const allowedDirectory = '/workspace/allowed directory'
const secret = 'fixture-secret-not-for-display'
const entry: McpCatalogEntry = {
  id: 'filesystem',
  name: 'Filesystem',
  description: 'Access an explicitly allowed directory.',
  transport: 'stdio',
  command: '@example/filesystem',
  version: '1.2.3',
  runtime: 'node',
  args: ['--directory', '{env:ALLOWED_DIR}', '--token={env:API_TOKEN}'],
  env: [
    { name: 'ALLOWED_DIR', source: 'user', description: 'Directory to allow.' },
    { name: 'API_TOKEN', source: 'user', description: 'Token for the fixture service.' },
    { name: 'OPTIONAL_NOTE', source: 'optional' },
  ],
  homepage: 'https://example.com/filesystem',
  tags: ['files'],
}
const expectedConfig = {
  type: 'stdio' as const,
  command: 'npx',
  args: ['--yes', '--', '@example/filesystem@1.2.3', '--directory', allowedDirectory, `--token=${secret}`],
  env: { ALLOWED_DIR: allowedDirectory, API_TOKEN: secret },
}
const mockedMcpApi = vi.mocked(mcpApi)
let installedServers: McpServerRecord[]

function record(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    name: entry.id,
    scope: 'user',
    transport: 'stdio',
    enabled: true,
    status: 'connected',
    statusLabel: 'Connected',
    configLocation: 'test configuration',
    summary: 'Fixture server',
    canEdit: true,
    canRemove: true,
    canReconnect: true,
    canToggle: true,
    config: expectedConfig,
    ...overrides,
  }
}

async function openReview() {
  const result = render(<McpSettings />)
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('radio', { name: 'Browse' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Install Filesystem' }))
  expect(screen.getByRole('heading', { name: 'Review Filesystem installation' })).toBeInTheDocument()
  return result
}

function fillEnvironment() {
  fireEvent.change(screen.getByLabelText(/^ALLOWED_DIR/), { target: { value: allowedDirectory } })
  fireEvent.change(screen.getByLabelText(/^API_TOKEN/), { target: { value: secret } })
}

function chooseScope(scope: McpWritableScope) {
  const labels = { local: 'Local', project: 'Project', user: 'User' }
  fireEvent.click(screen.getByRole('button', { name: labels[scope] }))
}

function confirmButton() {
  return screen.getByRole('button', { name: 'Confirm installation' })
}

describe('MCP catalog installation flow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    installedServers = []
    useMcpStore.setState(useMcpStore.getInitialState(), true)
    useSettingsStore.setState({ locale: 'en' })
    useSessionStore.setState({
      sessions: [{
        id: 'session-1', title: 'Test session', createdAt: '', modifiedAt: '', messageCount: 0,
        projectPath: currentProject, workDir: currentProject, workDirExists: true,
      }],
      activeSessionId: 'session-1',
    })
    vi.mocked(sessionsApi.getRecentProjects).mockResolvedValue({ projects: [] })
    mockedMcpApi.projectPaths.mockResolvedValue({ projectPaths: [configuredProject] })
    mockedMcpApi.catalog.mockResolvedValue({ catalog: { version: 1, servers: [entry] } })
    mockedMcpApi.list.mockImplementation(async (cwd) => {
      const visible = installedServers.filter((server) => (
        server.scope === 'user' || server.projectPath === cwd
      ))
      const byName = new Map<string, McpServerRecord>()
      const priority = (server: McpServerRecord) => server.scope === 'local' ? 2 : server.scope === 'project' ? 1 : 0
      for (const server of visible) {
        const existing = byName.get(server.name)
        if (!existing || priority(server) > priority(existing)) byName.set(server.name, server)
      }
      return { servers: [...byName.values()] }
    })
    mockedMcpApi.create.mockImplementation(async (name, payload, cwd) => {
      const server = record({ name, scope: payload.scope, config: payload.config })
      installedServers.push({ ...server, projectPath: payload.scope === 'user' ? undefined : cwd })
      return { server }
    })
    // Unexpected API paths fail locally instead of reaching a native server.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request in catalog test')))
  })

  afterEach(() => {
    cleanup()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('opens a review without saving and discards environment inputs when cancelled', async () => {
    await openReview()
    fillEnvironment()
    chooseScope('user')

    expect(mockedMcpApi.create).not.toHaveBeenCalled()
    expect(useMcpStore.getState().servers).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Install Filesystem' }))

    expect(screen.getByLabelText(/^ALLOWED_DIR/)).toHaveValue('')
    expect(screen.getByLabelText(/^API_TOKEN/)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'User' })).toHaveAttribute('aria-pressed', 'false')
    expect(confirmButton()).toBeDisabled()
    expect(mockedMcpApi.create).not.toHaveBeenCalled()
  })

  it.each(['local', 'project', 'user'] as const)(
    'requires explicit %s scope and passes the reviewed executable, arguments, and environment to create',
    async (scope) => {
      await openReview()
      fillEnvironment()
      expect(confirmButton()).toBeDisabled()

      chooseScope(scope)
      if (scope !== 'user') {
        expect(confirmButton()).toBeDisabled()
        expect(screen.getByLabelText('Project folder')).toHaveValue('')
        fireEvent.change(screen.getByLabelText('Project folder'), { target: { value: newProject } })
      } else {
        expect(screen.queryByLabelText('Project folder')).not.toBeInTheDocument()
      }
      expect(confirmButton()).toBeEnabled()
      fireEvent.click(confirmButton())

      await waitFor(() => expect(mockedMcpApi.create).toHaveBeenCalledExactlyOnceWith(
        entry.id,
        { scope, config: expectedConfig },
        scope === 'user' ? undefined : newProject,
      ))
      await waitFor(() => expect(screen.getByRole('radio', { name: 'Installed' })).toHaveAttribute('aria-checked', 'true'))
      expect(screen.getByRole('button', { name: 'Open filesystem' })).toBeInTheDocument()
      expect(useMcpStore.getState().servers).toEqual([
        record({ scope, projectPath: scope === 'user' ? undefined : newProject }),
      ])
      if (scope !== 'user') {
        expect(mockedMcpApi.list).toHaveBeenCalledWith(newProject)
      }
    },
  )

  it('hides entered values in password fields and uses placeholders in the configuration preview', async () => {
    const { container } = await openReview()
    fillEnvironment()
    const preview = screen.getByRole('region', { name: 'Configuration to save' })

    expect(screen.getByLabelText(/^ALLOWED_DIR/)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(/^API_TOKEN/)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(/^API_TOKEN/)).toHaveAttribute('autocomplete', 'off')
    expect(preview).toHaveTextContent('@example/filesystem@1.2.3')
    expect(preview).toHaveTextContent('[ALLOWED_DIR]')
    expect(preview).toHaveTextContent('[API_TOKEN]')
    expect(container).not.toHaveTextContent(secret)
    expect(container).not.toHaveTextContent(allowedDirectory)
    expect(mockedMcpApi.create).not.toHaveBeenCalled()
  })

  it('requires user and system environment values while allowing an unreferenced optional input to stay empty', async () => {
    mockedMcpApi.catalog.mockResolvedValue({
      catalog: { version: 1, servers: [{ ...entry, env: [...entry.env, { name: 'HOST_REGION', source: 'system' }] }] },
    })
    await openReview()
    chooseScope('user')
    expect(confirmButton()).toBeDisabled()
    fillEnvironment()
    expect(confirmButton()).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Enter a value for HOST_REGION.')
    fireEvent.change(screen.getByLabelText(/^HOST_REGION/), { target: { value: 'test-region' } })
    expect(screen.getByLabelText('OPTIONAL_NOTE')).toHaveValue('')
    expect(confirmButton()).toBeEnabled()
  })

  it('sends only one create for rapid confirmations and disables edits until it resolves', async () => {
    let resolveCreate!: (value: { server: McpServerRecord }) => void
    mockedMcpApi.create.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve }))
    await openReview()
    fillEnvironment()
    chooseScope('user')
    const confirm = confirmButton()

    act(() => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })

    await waitFor(() => expect(mockedMcpApi.create).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Saving configuration…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText(/^API_TOKEN/)).toBeDisabled()
    expect(useMcpStore.getState().servers).toEqual([])
    await act(async () => {
      installedServers = [record()]
      resolveCreate({ server: record() })
    })
    expect(screen.getByRole('radio', { name: 'Installed' })).toHaveAttribute('aria-checked', 'true')
    expect(mockedMcpApi.create).toHaveBeenCalledTimes(1)
  })

  it('retains the draft after host preflight rejection, redacts values in errors, and retries', async () => {
    mockedMcpApi.create.mockRejectedValueOnce(new ApiError(400, {
      message: `Host preflight failed for npx; supplied value ${secret}`,
    }))
    const { container } = await openReview()
    fillEnvironment()
    chooseScope('project')
    fireEvent.change(screen.getByLabelText('Project folder'), { target: { value: newProject } })
    fireEvent.click(confirmButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Host preflight failed for npx; supplied value [redacted]')
    expect(container).not.toHaveTextContent(secret)
    expect(screen.getByLabelText(/^API_TOKEN/)).toHaveValue(secret)
    expect(screen.getByLabelText('Project folder')).toHaveValue(newProject)
    expect(screen.getByRole('button', { name: 'Project' })).toHaveAttribute('aria-pressed', 'true')
    expect(useMcpStore.getState().servers).toEqual([])
    expect(mockedMcpApi.list).toHaveBeenCalledWith(newProject)
    expect(confirmButton()).toBeEnabled()
    fireEvent.click(confirmButton())

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Installed' })).toHaveAttribute('aria-checked', 'true'))
    expect(mockedMcpApi.create).toHaveBeenCalledTimes(2)
    expect(mockedMcpApi.create.mock.calls[1]).toEqual(mockedMcpApi.create.mock.calls[0])
  })

  it('reconciles a 409 duplicate conflict and requires a new name before retrying', async () => {
    mockedMcpApi.create.mockImplementationOnce(async () => {
      installedServers = [record()]
      throw new ApiError(409, { message: 'MCP server already exists: filesystem' })
    })
    await openReview()
    fillEnvironment()
    chooseScope('user')
    fireEvent.click(confirmButton())

    await waitFor(() => {
      const messages = screen.getAllByRole('alert').map((alert) => alert.textContent)
      expect(messages).toEqual(expect.arrayContaining([
        expect.stringContaining('MCP server already exists: filesystem'),
        expect.stringContaining('This name is already configured in the selected scope and project'),
      ]))
    })
    expect(confirmButton()).toBeDisabled()
    expect(screen.getByLabelText(/^API_TOKEN/)).toHaveValue(secret)
    expect(mockedMcpApi.create).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'filesystem-personal' } })
    expect(confirmButton()).toBeEnabled()
    fireEvent.click(confirmButton())

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Installed' })).toHaveAttribute('aria-checked', 'true'))
    expect(mockedMcpApi.create).toHaveBeenLastCalledWith('filesystem-personal', { scope: 'user', config: expectedConfig }, undefined)
    expect(useMcpStore.getState().servers.map((server) => server.name)).toEqual(['filesystem', 'filesystem-personal'])
  })

  it('allows a catalog entry installed for the user to be reviewed and installed at higher local precedence', async () => {
    installedServers = [record({ scope: 'user' })]
    await openReview()
    fillEnvironment()
    chooseScope('local')
    fireEvent.change(screen.getByLabelText('Project folder'), { target: { value: currentProject } })

    expect(confirmButton()).toBeEnabled()
    fireEvent.click(confirmButton())

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Installed' })).toHaveAttribute('aria-checked', 'true'))
    expect(mockedMcpApi.create).toHaveBeenCalledTimes(1)
    expect(useMcpStore.getState().servers.map(({ scope, projectPath }) => ({ scope, projectPath }))).toEqual([
      { scope: 'local', projectPath: currentProject },
      { scope: 'user', projectPath: undefined },
    ])
  })

  it.each([
    { existingScope: 'local', requestedScope: 'user' },
    { existingScope: 'project', requestedScope: 'user' },
    { existingScope: 'local', requestedScope: 'project' },
  ] as const)(
    'blocks a $requestedScope install hidden by a known $existingScope configuration with the same name',
    async ({ existingScope, requestedScope }) => {
      installedServers = [record({ scope: existingScope, projectPath: currentProject })]
      await openReview()
      fillEnvironment()
      chooseScope(requestedScope)
      if (requestedScope === 'project') {
        fireEvent.change(screen.getByLabelText('Project folder'), { target: { value: currentProject } })
      }

      expect(screen.getByRole('alert')).toHaveTextContent('A higher-priority configuration already uses this name. Choose another name so the new installation remains visible.')
      expect(confirmButton()).toBeDisabled()
      expect(mockedMcpApi.create).not.toHaveBeenCalled()

      fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'filesystem-new' } })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(confirmButton()).toBeEnabled()
    },
  )

  it('allows a project install when a same-name local record belongs to another project', async () => {
    installedServers = [record({ scope: 'local', projectPath: currentProject })]
    await openReview()
    fillEnvironment()
    chooseScope('project')
    fireEvent.change(screen.getByLabelText('Project folder'), { target: { value: newProject } })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
  })

  it('checks a newly selected project before create and rejects a previously unseen higher-priority record', async () => {
    installedServers = [record({ scope: 'local', projectPath: newProject })]
    await openReview()
    fillEnvironment()
    chooseScope('project')
    fireEvent.change(screen.getByLabelText('Project folder'), { target: { value: newProject } })

    expect(useMcpStore.getState().servers).toEqual([])
    expect(mockedMcpApi.list).not.toHaveBeenCalledWith(newProject)
    expect(confirmButton()).toBeEnabled()
    expect(mockedMcpApi.create).not.toHaveBeenCalled()
    fireEvent.click(confirmButton())

    const message = 'A higher-priority configuration already uses this name. Choose another name so the new installation remains visible.'
    await waitFor(() => {
      expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual(
        expect.arrayContaining([expect.stringContaining(message)]),
      )
    })
    expect(mockedMcpApi.list).toHaveBeenCalledWith(newProject)
    expect(mockedMcpApi.create).not.toHaveBeenCalled()
    expect(useMcpStore.getState().servers).toEqual(installedServers)
    expect(confirmButton()).toBeDisabled()
    expect(screen.getByLabelText(/^API_TOKEN/)).toHaveValue(secret)
  })

  it('does not create if the target lookup fails and retains inputs for a safe retry', async () => {
    await openReview()
    fillEnvironment()
    chooseScope('project')
    fireEvent.change(screen.getByLabelText('Project folder'), { target: { value: newProject } })
    mockedMcpApi.list.mockRejectedValueOnce(new Error('Target project unreadable'))
    fireEvent.click(confirmButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Target project unreadable')
    expect(mockedMcpApi.create).not.toHaveBeenCalled()
    expect(useMcpStore.getState().servers).toEqual([])
    expect(screen.getByLabelText('Project folder')).toHaveValue(newProject)
    expect(screen.getByLabelText(/^API_TOKEN/)).toHaveValue(secret)
    expect(confirmButton()).toBeEnabled()
    fireEvent.click(confirmButton())

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Installed' })).toHaveAttribute('aria-checked', 'true'))
    expect(mockedMcpApi.create).toHaveBeenCalledExactlyOnceWith(entry.id, { scope: 'project', config: expectedConfig }, newProject)
  })

  it('blocks a duplicate in the chosen project while allowing the same name in another project', async () => {
    installedServers = [record({ scope: 'project', projectPath: currentProject })]
    await openReview()
    fillEnvironment()
    chooseScope('project')
    fireEvent.change(screen.getByLabelText('Project folder'), { target: { value: currentProject } })

    expect(screen.getByRole('alert')).toHaveTextContent('This name is already configured in the selected scope and project.')
    expect(confirmButton()).toBeDisabled()
    expect(mockedMcpApi.create).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Project folder'), { target: { value: newProject } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
  })

  it('validates the server name before allowing confirmation', async () => {
    await openReview()
    fillEnvironment()
    chooseScope('user')
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'invalid name' } })

    expect(screen.getByLabelText(/^Name/)).toHaveAttribute('aria-invalid', 'true')
    expect(confirmButton()).toBeDisabled()
    expect(mockedMcpApi.create).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'valid-name_2' } })
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute('aria-invalid', 'false')
    expect(confirmButton()).toBeEnabled()
  })

  it('keeps a successfully saved record in Installed when the following refresh fails', async () => {
    await openReview()
    fillEnvironment()
    chooseScope('user')
    mockedMcpApi.list.mockImplementation(async () => {
      if (mockedMcpApi.create.mock.calls.length > 0) throw new Error('Refresh unavailable')
      return { servers: [] }
    })
    fireEvent.click(confirmButton())

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Installed' })).toHaveAttribute('aria-checked', 'true'))
    expect(screen.queryByRole('button', { name: 'Confirm installation' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open filesystem' })).toBeInTheDocument()
    expect(useMcpStore.getState().servers).toEqual([record({ projectPath: undefined })])
    expect(useMcpStore.getState().error).toBe('Refresh unavailable')
    expect(mockedMcpApi.create).toHaveBeenCalledTimes(1)

    mockedMcpApi.list.mockResolvedValue({ servers: installedServers })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(useMcpStore.getState().error).toBeNull())
    expect(screen.getByRole('button', { name: 'Open filesystem' })).toBeInTheDocument()
    expect(mockedMcpApi.create).toHaveBeenCalledTimes(1)
  })

  it('opens the existing manual editor for an unsupported runtime without creating configuration', async () => {
    mockedMcpApi.catalog.mockResolvedValue({
      catalog: { version: 1, servers: [{ ...entry, runtime: 'binary', command: '/opt/example/server' }] },
    })
    await openReview()

    expect(screen.getByRole('alert')).toHaveTextContent('This entry needs manual command configuration for its runtime.')
    expect(screen.queryByRole('button', { name: 'Confirm installation' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Configure manually' }))

    expect(screen.getByRole('heading', { name: 'Connect to a custom MCP' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Name/)).toHaveValue(entry.id)
    expect(screen.getByLabelText(/^Command/)).toHaveValue('')
    expect(mockedMcpApi.create).not.toHaveBeenCalled()
    expect(useMcpStore.getState().servers).toEqual([])
  })
})
