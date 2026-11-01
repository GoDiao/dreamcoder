import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspaceArtifacts: vi.fn(),
  openArtifact: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: { getWorkspaceArtifacts: mocks.getWorkspaceArtifacts },
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import type { ArtifactListItem, DesignSystemListItem } from '../../types/artifact'
import { useArtifactStore } from '../../stores/artifactStore'
import { useWorkspaceChatContextStore } from '../../stores/workspaceChatContextStore'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { ArtifactsView } from './ArtifactsView'

const item = (overrides: Partial<ArtifactListItem>): ArtifactListItem => ({
  name: 'report',
  artifactsDir: '/repo/dc_artifacts',
  dir: '/repo/dc_artifacts/report',
  workDir: '/repo',
  projectRoot: '/repo',
  branch: null,
  id: 'id-report',
  lastOpenedAt: null,
  entryMissing: false,
  thumbnailMtimeMs: null,
  origin: null,
  sessions: [],
  manifest: { version: 1, id: 'm', kind: 'page', title: 'Quarterly report', entry: 'index.html' },
  error: null,
  latestMtimeMs: 1,
  ...overrides,
})

const noSystems = { current: [], others: [] }

const system = (overrides: Partial<DesignSystemListItem>): DesignSystemListItem => ({
  name: 'alpha',
  dir: '/repo/dc_artifacts/systems/alpha',
  artifactsDir: '/repo/dc_artifacts',
  workDir: '/repo',
  manifest: { version: 1, name: 'Alpha system', source: 'bundled', license: 'Apache-2.0', author: 'Open Design contributors', libraryId: 'alpha' },
  error: null,
  ...overrides,
})

describe('ArtifactsView', () => {
  const initialPanel = useWorkspacePanelStore.getInitialState()
  const initialArtifacts = useArtifactStore.getInitialState()

  beforeEach(() => {
    mocks.openArtifact.mockResolvedValue(undefined)
    useWorkspacePanelStore.setState({ ...initialPanel, openArtifact: mocks.openArtifact }, true)
  })

  afterEach(() => {
    cleanup()
    useWorkspacePanelStore.setState(initialPanel, true)
    useArtifactStore.setState(initialArtifacts, true)
    useWorkspaceChatContextStore.setState(useWorkspaceChatContextStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('shows an empty state when there are no artifacts', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({ systems: noSystems, current: [], others: [] })
    render(<ArtifactsView sessionId="s1" />)
    expect(await screen.findByText(/No artifacts yet/)).toBeInTheDocument()
  })

  it('keeps the newest list when an older request answers after it', async () => {
    const deferred = <T,>() => {
      let resolve!: (value: T) => void
      const promise = new Promise<T>((done) => { resolve = done })
      return { promise, resolve }
    }
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    mocks.getWorkspaceArtifacts.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    render(<ArtifactsView sessionId="s1" />)
    act(() => useArtifactStore.setState({ writeVersion: 1 }))

    await act(async () => {
      second.resolve({ systems: noSystems, current: [item({ name: 'newer', manifest: { version: 1, id: 'n', kind: 'page', title: 'Newer page', entry: 'index.html' } })], others: [] })
    })
    await act(async () => {
      first.resolve({ systems: noSystems, current: [item({ name: 'older', manifest: { version: 1, id: 'o', kind: 'page', title: 'Older page', entry: 'index.html' } })], others: [] })
    })

    expect(screen.getByText('Newer page')).toBeInTheDocument()
    expect(screen.queryByText('Older page')).not.toBeInTheDocument()
  })

  it('lists this folder first and the read-only locations after it', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      systems: noSystems,
      current: [item({})],
      others: [item({ name: 'moved', workDir: null, projectRoot: null, manifest: { version: 1, id: 'm', kind: 'page', title: 'Moved page', entry: 'a.html' } })],
    })
    render(<ArtifactsView sessionId="s1" />)

    expect(await screen.findByText('Quarterly report')).toBeInTheDocument()
    expect(screen.getByText('This folder')).toBeInTheDocument()
    expect(screen.getByText('Elsewhere (read-only)')).toBeInTheDocument()
    expect(screen.getByText('Moved page')).toBeInTheDocument()
    expect(screen.getByText('No project')).toBeInTheDocument()
  })

  it('marks a broken manifest with its reason and does not open it', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      systems: noSystems,
      current: [item({ name: 'bad', manifest: null, error: 'title is required' })],
      others: [],
    })
    render(<ArtifactsView sessionId="s1" />)

    expect(await screen.findByText('Invalid manifest: title is required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^bad/ })).toBeDisabled()
  })

  it('shows an artifact whose entry file is missing and does not open it', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({ systems: noSystems, current: [item({ entryMissing: true })], others: [] })
    render(<ArtifactsView sessionId="s1" />)

    expect(await screen.findByText('Entry file is missing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Quarterly report/ })).toBeDisabled()
  })

  it('opens a canvas like any other artifact', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      systems: noSystems,
      current: [item({ name: 'board', manifest: { version: 1, id: 'm', kind: 'canvas', title: 'Board', entry: 'index.html' } })],
      others: [],
    })
    render(<ArtifactsView sessionId="s1" />)

    expect(await screen.findByText('Canvas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Board/ })).toBeEnabled()
  })

  it('opens the artifact the user clicks in this session and reports a failure', async () => {
    const report = item({})
    mocks.getWorkspaceArtifacts.mockResolvedValue({ systems: noSystems, current: [report], others: [] })
    render(<ArtifactsView sessionId="s1" />)

    fireEvent.click(await screen.findByRole('button', { name: /^Quarterly report/ }))
    expect(mocks.openArtifact).toHaveBeenCalledWith('s1', report, '/repo/dc_artifacts')

    mocks.openArtifact.mockRejectedValue(new Error('Entry file not found'))
    fireEvent.click(screen.getByRole('button', { name: /^Quarterly report/ }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Entry file not found'))
  })

  it('opens an artifact of the global store with the global root', async () => {
    const moved = item({ name: 'moved', workDir: null, projectRoot: null, artifactsDir: '/config/artifacts-global/dc_artifacts' })
    mocks.getWorkspaceArtifacts.mockResolvedValue({ systems: noSystems, current: [], others: [moved] })
    render(<ArtifactsView sessionId="s1" />)

    fireEvent.click(await screen.findByRole('button', { name: /^Quarterly report/ }))

    expect(mocks.openArtifact).toHaveBeenCalledWith('s1', moved, 'global')
  })

  it('shows the error when the list cannot be loaded and reloads on refresh and on artifact writes', async () => {
    mocks.getWorkspaceArtifacts.mockRejectedValueOnce(new Error('offline'))
    render(<ArtifactsView sessionId="s1" />)
    expect(await screen.findByText('offline')).toBeInTheDocument()

    mocks.getWorkspaceArtifacts.mockResolvedValue({ systems: noSystems, current: [item({})], others: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Quarterly report')).toBeInTheDocument()

    mocks.getWorkspaceArtifacts.mockClear()
    mocks.getWorkspaceArtifacts.mockResolvedValue({ systems: noSystems, current: [item({}), item({ name: 'second', manifest: { version: 1, id: 'm', kind: 'page', title: 'Second', entry: 'i.html' } })], others: [] })
    act(() => {
      useArtifactStore.setState({ writeVersion: 5 })
    })
    expect(await screen.findByText('Second')).toBeInTheDocument()
  })

  it('puts what this chat changed first and marks the two kinds differently', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      systems: noSystems,
      current: [
        item({ name: 'plain', manifest: { version: 1, id: 'm', kind: 'page', title: 'Plain', entry: 'i.html' } }),
        item({ name: 'maybe', manifest: { version: 1, id: 'm', kind: 'page', title: 'Maybe', entry: 'i.html' }, sessions: [{ sessionId: 's1', source: 'snapshot' }] }),
        item({ name: 'sure', manifest: { version: 1, id: 'm', kind: 'page', title: 'Sure', entry: 'i.html' }, sessions: [{ sessionId: 's1', source: 'tool' }, { sessionId: 's2', source: 'tool' }] }),
      ],
      others: [],
    })
    render(<ArtifactsView sessionId="s1" />)

    await screen.findByText('Sure')
    const titles = screen.getAllByRole('button', { name: /^(Plain|Maybe|Sure)/ }).map((button) => button.textContent ?? '')
    expect(titles[0]).toContain('Sure')
    expect(titles[1]).toContain('Maybe')
    expect(titles[2]).toContain('Plain')
    expect(screen.getByText('Changed in this chat')).toBeInTheDocument()
    expect(screen.getByText('May include other changes')).toBeInTheDocument()
  })

  it('does not mark an artifact that only another session changed', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({ systems: noSystems, current: [item({ sessions: [{ sessionId: 's2', source: 'tool' }] })], others: [] })
    render(<ArtifactsView sessionId="s1" />)
    await screen.findByText('Quarterly report')
    expect(screen.queryByText('Changed in this chat')).not.toBeInTheDocument()
  })

  it('shows the origin of an artifact that was moved out of a deleted worktree', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      systems: noSystems,
      current: [],
      others: [
        item({ name: 'moved', workDir: null, projectRoot: null, origin: { workDir: '/repo/wt', projectRoot: '/repo', branch: 'feature/x', } }),
      ],
    })
    render(<ArtifactsView sessionId="s1" />)

    expect(await screen.findByText('feature/x')).toBeInTheDocument()
  })

  it('adds the artifact folder to the chat as a reference', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({ systems: noSystems, current: [item({ dir: '/repo/dc_artifacts/report' })], others: [] })
    render(<ArtifactsView sessionId="s1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Quarterly report to chat' }))

    expect(useWorkspaceChatContextStore.getState().referencesBySession['s1']).toEqual([
      expect.objectContaining({ kind: 'file', path: '/repo/dc_artifacts/report', absolutePath: '/repo/dc_artifacts/report', name: 'Quarterly report', isDirectory: true }),
    ])
  })

  it('lists the design systems of this folder and of other places below the artifacts', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      current: [],
      others: [],
      systems: {
        current: [system({}), system({ name: 'site', manifest: { version: 1, name: 'Site look', source: 'extracted', license: 'unspecified', author: 'Agent' } })],
        others: [system({ name: 'shared', workDir: null, manifest: { version: 1, name: 'Shared look', source: 'bundled', license: 'MIT', author: 'x' } })],
      },
    })
    render(<ArtifactsView sessionId="s1" />)

    expect(await screen.findByText('Alpha system')).toBeInTheDocument()
    expect(screen.queryByText(/No artifacts yet/)).not.toBeInTheDocument()
    expect(screen.getByText('Design systems')).toBeInTheDocument()
    expect(screen.getAllByText('From the library')).toHaveLength(2)
    expect(screen.getByText('Extracted')).toBeInTheDocument()
    expect(screen.getByText('Design systems · Elsewhere (read-only)')).toBeInTheDocument()
    expect(screen.getByText('Shared look')).toBeInTheDocument()
    expect(screen.getByText('No project')).toBeInTheDocument()
  })

  it('shows a design system with a broken manifest by its folder name and the reason', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({
      current: [],
      others: [],
      systems: { current: [system({ name: 'broken', manifest: null, error: 'name is required' })], others: [] },
    })
    render(<ArtifactsView sessionId="s1" />)

    expect(await screen.findByText('broken')).toBeInTheDocument()
    expect(screen.getByText('Invalid manifest: name is required')).toBeInTheDocument()
  })

  it('adds the design system folder to the chat as a reference', async () => {
    mocks.getWorkspaceArtifacts.mockResolvedValue({ current: [], others: [], systems: { current: [system({})], others: [] } })
    render(<ArtifactsView sessionId="s1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Alpha system to chat' }))

    expect(useWorkspaceChatContextStore.getState().referencesBySession['s1']).toEqual([
      expect.objectContaining({ kind: 'file', path: '/repo/dc_artifacts/systems/alpha', name: 'Alpha system', isDirectory: true }),
    ])
  })
})
