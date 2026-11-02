import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openById: vi.fn(),
  markOpened: vi.fn(),
  placeBrowserGuest: vi.fn(),
  release: vi.fn(),
  closeBrowser: vi.fn(),
  submitBrowserInput: vi.fn(),
  browserReload: vi.fn(),
  setCanvasMessageHandler: vi.fn(),
  continueInSession: vi.fn(),
  continueInNewSession: vi.fn(),
  toastError: vi.fn(),
  exportArtifactPage: vi.fn(),
}))

vi.mock('../../api/artifacts', () => ({ artifactsApi: { openById: mocks.openById, markOpened: mocks.markOpened } }))
vi.mock('../../lib/browserGuests', () => ({
  placeBrowserGuest: mocks.placeBrowserGuest,
  closeBrowser: mocks.closeBrowser,
  submitBrowserInput: mocks.submitBrowserInput,
  browserReload: mocks.browserReload,
  setCanvasMessageHandler: mocks.setCanvasMessageHandler,
}))
vi.mock('../../lib/continueArtifactInSession', () => ({
  continueArtifactInSession: mocks.continueInSession,
  continueArtifactInNewSession: mocks.continueInNewSession,
}))
vi.mock('../../lib/artifactExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/artifactExport')>()),
  exportArtifactPage: mocks.exportArtifactPage,
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import type { ArtifactListItem } from '../../types/artifact'
import { useArtifactListStore } from '../../stores/artifactListStore'
import { useArtifactViewStore } from '../../stores/artifactViewStore'
import { useSessionStore } from '../../stores/sessionStore'
import { ARTIFACT_VIEW_TAB, ArtifactViewer } from './ArtifactViewer'

const viewing = { id: 'id-report', name: 'report', title: 'Quarterly report' }

const listed: ArtifactListItem = {
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
  manifest: { version: 1, id: 'id-report', kind: 'page', title: 'Quarterly report', entry: 'index.html' },
  error: null,
  latestMtimeMs: 1,
}

const session = (id: string, title: string, workDirExists = true) => ({
  id,
  title,
  createdAt: '',
  modifiedAt: '',
  messageCount: 1,
  projectPath: '/repo',
  workDir: '/repo',
  workDirExists,
})

async function chooseFromMenu(name: string) {
  const trigger = screen.getByRole('button', { name: 'Continue in a chat' })
  act(() => trigger.focus())
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.keyDown(await screen.findByRole('menuitem', { name }), { key: 'Enter' })
}

describe('ArtifactViewer', () => {
  beforeEach(() => {
    mocks.placeBrowserGuest.mockReturnValue(mocks.release)
    mocks.openById.mockResolvedValue({ rootDir: '/repo/dc_artifacts', filePath: '/repo/dc_artifacts/report/index.html' })
    mocks.submitBrowserInput.mockResolvedValue(undefined)
    mocks.markOpened.mockResolvedValue({ ok: true })
    mocks.continueInSession.mockResolvedValue(undefined)
    mocks.continueInNewSession.mockResolvedValue(undefined)
    useArtifactListStore.setState({ items: [listed] })
    useSessionStore.setState({ sessions: [session('s1', 'First chat'), session('s2', 'Gone chat', false)] })
  })

  afterEach(() => {
    cleanup()
    useArtifactListStore.setState(useArtifactListStore.getInitialState(), true)
    useArtifactViewStore.setState(useArtifactViewStore.getInitialState(), true)
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('shows the artifact in a page that belongs to no chat, found by id, and records that it was opened', async () => {
    render(<ArtifactViewer viewing={viewing} />)

    await waitFor(() => expect(mocks.submitBrowserInput).toHaveBeenCalledWith(null, ARTIFACT_VIEW_TAB, '/repo/dc_artifacts/report/index.html', '/repo/dc_artifacts'))
    expect(mocks.openById).toHaveBeenCalledWith('id-report')
    expect(mocks.markOpened).toHaveBeenCalledWith('id-report')
    expect(mocks.placeBrowserGuest).toHaveBeenCalledWith(ARTIFACT_VIEW_TAB, screen.getByTestId('artifact-viewer-stage'), true)
  })

  it('puts the title, back button and actions in a window drag region header', async () => {
    render(<ArtifactViewer viewing={viewing} />)

    const header = screen.getByTestId('viewer-header')
    expect(header).toHaveClass('window-drag-region')
    expect(within(header).getByRole('heading', { name: viewing.title })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Export' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.markOpened).toHaveBeenCalled())
  })

  it('listens for the canvas messages of the page and stops when the viewer goes away', async () => {
    const view = render(<ArtifactViewer viewing={viewing} />)
    await waitFor(() => expect(mocks.setCanvasMessageHandler).toHaveBeenCalledWith(ARTIFACT_VIEW_TAB, expect.any(Function)))
    view.unmount()
    expect(mocks.setCanvasMessageHandler).toHaveBeenLastCalledWith(ARTIFACT_VIEW_TAB, null)
  })

  it('closes the page when it goes away', () => {
    const { unmount } = render(<ArtifactViewer viewing={viewing} />)
    unmount()
    expect(mocks.release).toHaveBeenCalled()
    expect(mocks.closeBrowser).toHaveBeenCalledWith(ARTIFACT_VIEW_TAB)
  })

  it('reports an artifact that can no longer be found', async () => {
    mocks.openById.mockRejectedValue(new Error('Artifact not found: id-report'))
    render(<ArtifactViewer viewing={viewing} />)

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Artifact not found: id-report'))
    expect(mocks.submitBrowserInput).not.toHaveBeenCalled()
    expect(mocks.markOpened).not.toHaveBeenCalled()
  })

  it('goes back to the list and reloads the page on request', () => {
    useArtifactViewStore.setState({ viewing })
    render(<ArtifactViewer viewing={viewing} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(mocks.browserReload).toHaveBeenCalledWith(ARTIFACT_VIEW_TAB)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(useArtifactViewStore.getState().viewing).toBeNull()
  })

  it('offers a new chat in the artifact project and the chats that still have a folder', async () => {
    render(<ArtifactViewer viewing={viewing} />)

    const trigger = screen.getByRole('button', { name: 'Continue in a chat' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('menuitem', { name: 'First chat' })
    expect(screen.getByText('Existing chats')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Gone chat' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'First chat' }), { key: 'Enter' })

    await waitFor(() => expect(mocks.continueInSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'id-report' }), 's1', 'First chat'))
  })

  it('starts a new chat in the project folder', async () => {
    render(<ArtifactViewer viewing={viewing} />)

    await chooseFromMenu('New chat in its project')

    await waitFor(() => expect(mocks.continueInNewSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'id-report' }), '/repo'))
  })

  it('tells the user a failed continue and does nothing else', async () => {
    mocks.continueInSession.mockRejectedValue(new Error('disk full'))
    render(<ArtifactViewer viewing={viewing} />)

    await chooseFromMenu('First chat')

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('disk full'))
  })

  it('exports the viewer page as a page that belongs to no chat', async () => {
    mocks.exportArtifactPage.mockResolvedValue({ status: 'cancelled' })
    render(<ArtifactViewer viewing={viewing} />)

    const trigger = screen.getByRole('button', { name: 'Export' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Export as PDF' }), { key: 'Enter' })

    await waitFor(() => expect(mocks.exportArtifactPage).toHaveBeenCalledWith(expect.objectContaining({ tabId: ARTIFACT_VIEW_TAB, sessionId: null, format: 'pdf', title: 'Quarterly report' })))
  })
})
