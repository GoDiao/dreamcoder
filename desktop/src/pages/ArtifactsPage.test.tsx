import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))

vi.mock('../components/design/DesignMode', () => ({ DesignMode: () => <div data-testid="design-mode" /> }))
vi.mock('../components/artifacts/ArtifactViewer', () => ({
  ArtifactViewer: ({ viewing }: { viewing: { title: string } }) => <div data-testid="viewer">{viewing.title}</div>,
}))

import type { ArtifactListItem } from '../types/artifact'
import { useArtifactListStore } from '../stores/artifactListStore'
import { useArtifactStore } from '../stores/artifactStore'
import { useArtifactViewStore } from '../stores/artifactViewStore'
import { ArtifactsPage } from './ArtifactsPage'

const item = (overrides: Partial<ArtifactListItem> & { name: string }): ArtifactListItem => ({
  artifactsDir: '/repo/dc_artifacts',
  dir: `/repo/dc_artifacts/${overrides.name}`,
  workDir: '/repo',
  projectRoot: '/repo',
  branch: null,
  id: `id-${overrides.name}`,
  lastOpenedAt: null,
  entryMissing: false,
  thumbnailMtimeMs: null,
  origin: null,
  sessions: [],
  manifest: { version: 1, id: `id-${overrides.name}`, kind: 'page', title: overrides.name, entry: 'index.html' },
  error: null,
  latestMtimeMs: 1,
  ...overrides,
})

const initialList = useArtifactListStore.getInitialState()
const initialView = useArtifactViewStore.getInitialState()
const initialArtifacts = useArtifactStore.getInitialState()

function setItems(items: ArtifactListItem[]) {
  useArtifactListStore.setState({ items, loading: false, error: null, load: mocks.load })
}

describe('ArtifactsPage', () => {
  beforeEach(() => {
    mocks.load.mockResolvedValue(undefined)
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    useArtifactListStore.setState(initialList, true)
    useArtifactViewStore.setState(initialView, true)
    useArtifactStore.setState(initialArtifacts, true)
    localStorage.clear()
    vi.clearAllMocks()
  })

  const titles = () => screen.getAllByTestId('artifact-card').map((card) => within(card).getAllByText(/./)[0]!.textContent)

  it('shows the cached cards at once and reloads in the background', () => {
    setItems([item({ name: 'cached' })])
    render(<ArtifactsPage />)

    expect(screen.getByText('cached')).toBeInTheDocument()
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('makes the title row a window drag region', () => {
    render(<ArtifactsPage />)
    expect(screen.getByRole('heading', { name: 'Artifacts' }).parentElement).toHaveClass('window-drag-region')
  })

  it('reloads from the refresh button, which is disabled while a load is running', () => {
    setItems([item({ name: 'cached' })])
    render(<ArtifactsPage />)
    mocks.load.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(mocks.load).toHaveBeenCalledTimes(1)

    act(() => useArtifactListStore.setState({ loading: true }))
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  })

  it('reloads when the CLI reports a written artifact', () => {
    setItems([])
    render(<ArtifactsPage />)
    mocks.load.mockClear()

    act(() => {
      useArtifactStore.setState({ writeVersion: 3 })
    })

    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state when there are no artifacts and a different one when a filter matches nothing', () => {
    setItems([])
    const { unmount } = render(<ArtifactsPage />)
    expect(screen.getByText(/No artifacts yet/)).toBeInTheDocument()
    unmount()

    setItems([item({ name: 'a' })])
    render(<ArtifactsPage />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search artifacts' }), { target: { value: 'zzz' } })
    expect(screen.getByText('No artifacts match.')).toBeInTheDocument()
  })

  it('orders by last opened, then by file change time for artifacts never opened', () => {
    setItems([
      item({ name: 'old-unopened', latestMtimeMs: 10 }),
      item({ name: 'new-unopened', latestMtimeMs: 500 }),
      item({ name: 'opened-recently', latestMtimeMs: 1, lastOpenedAt: 1000 }),
    ])
    render(<ArtifactsPage />)

    expect(titles()).toEqual(['opened-recently', 'new-unopened', 'old-unopened'])
  })

  it('searches by title, name and project', () => {
    setItems([
      item({ name: 'alpha', manifest: { version: 1, id: 'a', kind: 'page', title: 'Sales deck', entry: 'i.html' } }),
      item({ name: 'beta', projectRoot: '/work/billing', workDir: '/work/billing' }),
    ])
    render(<ArtifactsPage />)
    const search = screen.getByRole('searchbox', { name: 'Search artifacts' })

    fireEvent.change(search, { target: { value: 'sales' } })
    expect(titles()).toEqual(['Sales deck'])
    fireEvent.change(search, { target: { value: 'billing' } })
    expect(titles()).toEqual(['beta'])
  })

  it('shows what is wrong with a broken manifest and does not open it', () => {
    setItems([item({ name: 'bad', manifest: null, id: null, error: 'id is required' })])
    render(<ArtifactsPage />)

    expect(screen.getByText('Invalid manifest: id is required')).toBeInTheDocument()
    expect(screen.getByTestId('artifact-card')).toBeDisabled()
  })

  it('shows an artifact whose entry file is missing as such and does not open it', () => {
    setItems([item({ name: 'hollow', entryMissing: true })])
    render(<ArtifactsPage />)

    expect(screen.getByText('Entry file is missing')).toBeInTheDocument()
    expect(screen.getByTestId('artifact-card')).toBeDisabled()
  })

  it('labels artifacts without a project and where they came from', () => {
    setItems([item({ name: 'moved', workDir: null, projectRoot: null, origin: { workDir: '/repo/wt', projectRoot: '/repo', branch: 'feature/x' } })])
    render(<ArtifactsPage />)

    expect(screen.getByText('No project · repo · feature/x')).toBeInTheDocument()
  })

  it('opens the viewer for the clicked card', () => {
    setItems([item({ name: 'report', manifest: { version: 1, id: 'id-report', kind: 'page', title: 'Quarterly report', entry: 'i.html' } })])
    render(<ArtifactsPage />)

    fireEvent.click(screen.getByTestId('artifact-card'))

    expect(useArtifactViewStore.getState().viewing).toEqual({ id: 'id-report', name: 'report', title: 'Quarterly report' })
    expect(screen.getByTestId('viewer')).toHaveTextContent('Quarterly report')
  })

  it('shows the viewer again after a restart when one was open', () => {
    setItems([item({ name: 'report' })])
    useArtifactViewStore.setState({ viewing: { id: 'id-report', name: 'report', title: 'Report' } })
    render(<ArtifactsPage />)

    expect(screen.getByTestId('viewer')).toBeInTheDocument()
    expect(screen.queryByTestId('artifacts-page')).not.toBeInTheDocument()
  })

  it('reloads when the viewer is closed, so the opened mark and the thumbnail show', () => {
    setItems([item({ name: 'report' })])
    useArtifactViewStore.setState({ viewing: { id: 'id-report', name: 'report', title: 'Report' } })
    render(<ArtifactsPage />)
    mocks.load.mockClear()

    act(() => useArtifactViewStore.getState().close())

    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('filters by project and by artifacts without a project', async () => {
    setItems([
      item({ name: 'alpha-page', projectRoot: '/work/alpha', workDir: '/work/alpha' }),
      item({ name: 'beta-page', projectRoot: '/work/beta', workDir: '/work/beta' }),
      item({ name: 'moved-page', workDir: null, projectRoot: null }),
    ])
    render(<ArtifactsPage />)
    const trigger = screen.getByRole('combobox', { name: 'Project' })
    const choose = async (name: string) => {
      act(() => trigger.focus())
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      fireEvent.click(await screen.findByRole('option', { name }))
    }

    await choose('beta')
    expect(titles()).toEqual(['beta-page'])
    await choose('No project')
    expect(titles()).toEqual(['moved-page'])
    await choose('All projects')
    expect(titles()).toHaveLength(3)
  })

  it('opens the design mode from the Design entry and shows it in place of the list', () => {
    setItems([item({ name: 'a' })])
    render(<ArtifactsPage />)

    fireEvent.click(screen.getByTestId('design-entry'))

    expect(screen.getByTestId('design-mode')).toBeInTheDocument()
    expect(screen.queryByTestId('artifacts-page')).not.toBeInTheDocument()
  })

  it('offers the Design entry when there are no artifacts yet', () => {
    setItems([])
    render(<ArtifactsPage />)

    expect(screen.getByTestId('design-entry')).toBeInTheDocument()
  })

  it('shows the Design entry as a tile under Make something new, named only Design', () => {
    setItems([item({ name: 'a' })])
    render(<ArtifactsPage />)

    const entry = screen.getByRole('button', { name: 'Design' })
    expect(entry).toBe(screen.getByTestId('design-entry'))
    expect(screen.getByText('Make something new')).toBeInTheDocument()
    expect(screen.getByText('More types coming soon')).toBeInTheDocument()
    expect(entry.parentElement).not.toContainElement(screen.getByRole('searchbox', { name: 'Search artifacts' }))
  })

  it('switches between cards and list, passes the layout to the cards and remembers it between visits', () => {
    setItems([item({ name: 'a' })])
    const { unmount } = render(<ArtifactsPage />)

    expect(screen.getByRole('radio', { name: 'Cards' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('artifact-card')).toHaveClass('flex-col')
    fireEvent.click(screen.getByRole('radio', { name: 'List' }))
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('artifact-card')).not.toHaveClass('flex-col')
    expect(localStorage.getItem('dreamcoder-artifacts-layout')).toBe('list')
    unmount()

    render(<ArtifactsPage />)
    expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('artifact-card')).not.toHaveClass('flex-col')
  })
})
