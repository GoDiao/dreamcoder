import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createArtifact: vi.fn(),
  installSystem: vi.fn(),
  createSession: vi.fn(),
  connectToSession: vi.fn(),
  sendMessage: vi.fn(),
  openTab: vi.fn(),
}))

vi.mock('../api/design', () => ({ designApi: { createArtifact: mocks.createArtifact, installSystem: mocks.installSystem } }))
vi.mock('../stores/sessionStore', () => ({
  useSessionStore: { getState: () => ({ createSession: mocks.createSession, sessions: [{ id: 's-new', title: 'New chat' }] }) },
}))
vi.mock('../stores/chatStore', () => ({
  useChatStore: { getState: () => ({ connectToSession: mocks.connectToSession, sendMessage: mocks.sendMessage }) },
}))
vi.mock('../stores/tabStore', () => ({ useTabStore: { getState: () => ({ openTab: mocks.openTab }) } }))

import { t } from '../i18n'
import { startDesignSession } from './startDesignSession'

describe('startDesignSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createSession.mockResolvedValue('s-new')
    mocks.createArtifact.mockResolvedValue({ dir: '/repo/dc_artifacts/saas' })
    mocks.installSystem.mockResolvedValue({ dir: '/repo/dc_artifacts/systems/paper' })
  })

  it('opens a chat in the project that starts design mode', async () => {
    expect(await startDesignSession('/repo')).toBe('s-new')

    expect(mocks.createArtifact).not.toHaveBeenCalled()
    expect(mocks.createSession).toHaveBeenCalledWith('/repo')
    expect(mocks.connectToSession).toHaveBeenCalledWith('s-new')
    expect(mocks.sendMessage).toHaveBeenCalledWith('s-new', '/design', [])
    expect(mocks.openTab).toHaveBeenCalledWith('s-new', 'New chat')
  })

  it('creates the artifact from the template first and hands its folder to the design skill', async () => {
    await startDesignSession('/repo', { template: { id: 'saas', title: 'SaaS landing page' } })

    expect(mocks.createArtifact).toHaveBeenCalledWith({ project: '/repo', templateId: 'saas', title: 'SaaS landing page' })
    expect(mocks.sendMessage).toHaveBeenCalledWith('s-new', '/design /repo/dc_artifacts/saas', [])
  })

  it('passes the design system to the artifact and does not copy it again for the session', async () => {
    await startDesignSession('/repo', { template: { id: 'saas', title: 'SaaS' }, designSystemId: 'paper' })

    expect(mocks.createArtifact).toHaveBeenCalledWith({ project: '/repo', templateId: 'saas', title: 'SaaS', designSystemId: 'paper' })
    expect(mocks.installSystem).not.toHaveBeenCalled()
    expect(mocks.sendMessage).toHaveBeenCalledWith('s-new', '/design /repo/dc_artifacts/saas', [])
  })

  it('copies the design system into the new session and hands its folder to the design skill when there is no template', async () => {
    await startDesignSession('/repo', { designSystemId: 'paper' })

    expect(mocks.createArtifact).not.toHaveBeenCalled()
    expect(mocks.installSystem).toHaveBeenCalledWith('s-new', 'paper')
    expect(mocks.sendMessage).toHaveBeenCalledWith('s-new', '/design /repo/dc_artifacts/systems/paper', [])
  })

  it('opens no chat tab and sends nothing when the design system could not be copied', async () => {
    mocks.installSystem.mockRejectedValue(new Error('read-only folder'))

    await expect(startDesignSession('/repo', { designSystemId: 'paper' })).rejects.toThrow('read-only folder')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('sends the clone request with the address and creates nothing in the project first', async () => {
    await startDesignSession('/repo', { cloneAddress: 'https://example.com/' })

    expect(mocks.createArtifact).not.toHaveBeenCalled()
    expect(mocks.installSystem).not.toHaveBeenCalled()
    expect(mocks.sendMessage).toHaveBeenCalledWith('s-new', `/design ${t('design.cloneTitle')} https://example.com/`, [])
    expect(mocks.openTab).toHaveBeenCalledWith('s-new', 'New chat')
  })

  it('opens no chat when the artifact could not be created', async () => {
    mocks.createArtifact.mockRejectedValue(new Error('disk full'))

    await expect(startDesignSession('/repo', { template: { id: 'saas', title: 'SaaS' } })).rejects.toThrow('disk full')
    expect(mocks.createSession).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })
})
