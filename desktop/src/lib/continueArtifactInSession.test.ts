import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copyInto: vi.fn(),
  openArtifact: vi.fn(),
  createSession: vi.fn(),
  openTab: vi.fn(),
  addReference: vi.fn(),
  sessions: [] as Array<{ id: string; title: string }>,
}))

vi.mock('../api/artifacts', () => ({ artifactsApi: { copyInto: mocks.copyInto } }))
vi.mock('../stores/sessionStore', () => ({
  useSessionStore: { getState: () => ({ createSession: mocks.createSession, sessions: mocks.sessions }) },
}))
vi.mock('../stores/tabStore', () => ({ useTabStore: { getState: () => ({ openTab: mocks.openTab }) } }))
vi.mock('../stores/workspacePanelStore', () => ({ useWorkspacePanelStore: { getState: () => ({ openArtifact: mocks.openArtifact }) } }))
vi.mock('../stores/workspaceChatContextStore', () => ({ useWorkspaceChatContextStore: { getState: () => ({ addReference: mocks.addReference }) } }))

import { continueArtifactInNewSession, continueArtifactInSession } from './continueArtifactInSession'

const artifact = {
  id: 'id-1',
  name: 'report',
  manifest: { version: 1 as const, id: 'id-1', kind: 'page' as const, title: 'Quarterly report', entry: 'index.html' },
}

describe('continueArtifactInSession', () => {
  beforeEach(() => {
    mocks.copyInto.mockResolvedValue({ id: 'id-2', name: 'report-2', artifactsDir: '/repo/dc_artifacts', dir: '/repo/dc_artifacts/report-2' })
    mocks.openArtifact.mockResolvedValue(undefined)
    mocks.sessions.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('copies the artifact into the chat, opens its tab and puts it in the input as a reference', async () => {
    await continueArtifactInSession(artifact, 's1', 'My chat')

    expect(mocks.copyInto).toHaveBeenCalledWith('id-1', 's1')
    expect(mocks.openTab).toHaveBeenCalledWith('s1', 'My chat')
    expect(mocks.openArtifact).toHaveBeenCalledWith('s1', expect.objectContaining({ id: 'id-2', name: 'report-2' }), '/repo/dc_artifacts')
    expect(mocks.addReference).toHaveBeenCalledWith('s1', {
      kind: 'file',
      path: '/repo/dc_artifacts/report-2',
      absolutePath: '/repo/dc_artifacts/report-2',
      name: 'Quarterly report',
      isDirectory: true,
    })
  })

  it('opens a canvas with its manifest so the tab is a canvas tab', async () => {
    const canvas = { ...artifact, manifest: { ...artifact.manifest, kind: 'canvas' as const } }
    await continueArtifactInSession(canvas, 's1', 'My chat')

    expect(mocks.openArtifact).toHaveBeenCalledWith('s1', expect.objectContaining({ manifest: canvas.manifest }), '/repo/dc_artifacts')
  })

  it('stops before touching any tab when the copy fails', async () => {
    mocks.copyInto.mockRejectedValue(new Error('disk full'))
    await expect(continueArtifactInSession(artifact, 's1', 'My chat')).rejects.toThrow('disk full')
    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(mocks.addReference).not.toHaveBeenCalled()
  })

  it('refuses an artifact without an id', async () => {
    await expect(continueArtifactInSession({ ...artifact, id: null }, 's1', 'x')).rejects.toThrow('no id')
    expect(mocks.copyInto).not.toHaveBeenCalled()
  })

  it('creates a session in the project folder first when asked for a new chat', async () => {
    mocks.createSession.mockResolvedValue('new-session')
    mocks.sessions.push({ id: 'new-session', title: 'New chat' })

    await continueArtifactInNewSession(artifact, '/repo')

    expect(mocks.createSession).toHaveBeenCalledWith('/repo')
    expect(mocks.copyInto).toHaveBeenCalledWith('id-1', 'new-session')
    expect(mocks.openTab).toHaveBeenCalledWith('new-session', 'New chat')
  })
})
