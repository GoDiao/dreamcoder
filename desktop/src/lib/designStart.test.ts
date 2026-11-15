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
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'
import { designStartLabel, openDesignStart, prepareDesignStart } from './designStart'

describe('openDesignStart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceChatContextStore.setState(useWorkspaceChatContextStore.getInitialState(), true)
    mocks.createSession.mockResolvedValue('s-new')
  })

  it('opens a chat in the project with the start in its composer, and sends and creates nothing', async () => {
    const start = { command: '/slides' as const, project: '/repo', template: { id: 'grove', title: 'Grove' } }

    expect(await openDesignStart(start)).toBe('s-new')

    expect(mocks.createSession).toHaveBeenCalledWith('/repo')
    expect(mocks.connectToSession).toHaveBeenCalledWith('s-new')
    expect(mocks.openTab).toHaveBeenCalledWith('s-new', 'New chat')
    expect(useWorkspaceChatContextStore.getState().startsBySession['s-new']).toEqual(start)
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.createArtifact).not.toHaveBeenCalled()
    expect(mocks.installSystem).not.toHaveBeenCalled()
  })

  it('opens no tab and keeps no start when the chat could not be created', async () => {
    mocks.createSession.mockRejectedValue(new Error('offline'))

    await expect(openDesignStart({ command: '/design', project: '/repo' })).rejects.toThrow('offline')
    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(useWorkspaceChatContextStore.getState().startsBySession).toEqual({})
  })
})

describe('prepareDesignStart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createArtifact.mockResolvedValue({ dir: '/repo/dc_artifacts/saas' })
    mocks.installSystem.mockResolvedValue({ dir: '/repo/dc_artifacts/systems/paper' })
  })

  it('starts design mode with the bare command when nothing was chosen', async () => {
    expect(await prepareDesignStart('s-new', { command: '/design', project: '/repo' })).toBe('/design')
    expect(mocks.createArtifact).not.toHaveBeenCalled()
    expect(mocks.installSystem).not.toHaveBeenCalled()
  })

  it('creates the artifact from the template and hands its folder to the skill', async () => {
    expect(await prepareDesignStart('s-new', { command: '/design', project: '/repo', template: { id: 'saas', title: 'SaaS landing page' } }))
      .toBe('/design /repo/dc_artifacts/saas')
    expect(mocks.createArtifact).toHaveBeenCalledWith({ project: '/repo', templateId: 'saas', title: 'SaaS landing page' })
  })

  it('passes the design system to the artifact and does not copy it again for the session', async () => {
    await prepareDesignStart('s-new', { command: '/design', project: '/repo', template: { id: 'saas', title: 'SaaS' }, designSystem: { id: 'paper', name: 'Paper' } })

    expect(mocks.createArtifact).toHaveBeenCalledWith({ project: '/repo', templateId: 'saas', title: 'SaaS', designSystemId: 'paper' })
    expect(mocks.installSystem).not.toHaveBeenCalled()
  })

  it('copies the design system into the session and hands its folder to the skill when there is no template', async () => {
    expect(await prepareDesignStart('s-new', { command: '/slides', project: '/repo', designSystem: { id: 'paper', name: 'Paper' } }))
      .toBe('/slides /repo/dc_artifacts/systems/paper')
    expect(mocks.installSystem).toHaveBeenCalledWith('s-new', 'paper')
  })

  it('asks for the clone with the address and creates nothing in the project', async () => {
    expect(await prepareDesignStart('s-new', { command: '/design', project: '/repo', cloneAddress: 'https://example.com/' }))
      .toBe(`/design ${t('design.cloneTitle')} https://example.com/`)
    expect(mocks.createArtifact).not.toHaveBeenCalled()
    expect(mocks.installSystem).not.toHaveBeenCalled()
  })

  it('passes a failure to create the artifact on to the caller', async () => {
    mocks.createArtifact.mockRejectedValue(new Error('disk full'))
    await expect(prepareDesignStart('s-new', { command: '/slides', project: '/repo', template: { id: 'grove', title: 'Grove' } })).rejects.toThrow('disk full')
  })
})

describe('designStartLabel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('names the scope, the template or the clone, and the design system', () => {
    expect(designStartLabel({ command: '/slides', project: '/repo' }, t)).toBe('Slides')
    expect(designStartLabel({ command: '/slides', project: '/repo', template: { id: 'grove', title: 'Grove' } }, t)).toBe('Slides · Grove')
    expect(designStartLabel({ command: '/design', project: '/repo', template: { id: 'saas', title: 'SaaS' }, designSystem: { id: 'paper', name: 'Paper' } }, t))
      .toBe('Design · SaaS · Design system: Paper')
    expect(designStartLabel({ command: '/design', project: '/repo', cloneAddress: 'https://example.com/' }, t)).toBe('Clone example.com')
    expect(designStartLabel({ command: '/design', project: '/repo', cloneAddress: 'https://example.com/pricing' }, t)).toBe('Clone example.com/pricing')
  })

  it('follows the language of the app', () => {
    useSettingsStore.setState({ locale: 'zh' })
    expect(designStartLabel({ command: '/slides', project: '/repo', template: { id: 'grove', title: 'Grove' } }, t)).toBe('幻灯片 · Grove')
    expect(designStartLabel({ command: '/design', project: '/repo', cloneAddress: 'https://example.com/' }, t)).toBe('复刻 example.com')
  })
})
