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
import { designStartLabel, designStartOfCommand, openDesignStart, prepareDesignStart, typedDesignStart } from './designStart'

describe('openDesignStart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceChatContextStore.setState(useWorkspaceChatContextStore.getInitialState(), true)
    mocks.createSession.mockResolvedValue('s-new')
  })

  it('opens a chat in the project with the start in its composer, and sends and creates nothing', async () => {
    const start = { command: '/slides' as const, template: { id: 'grove', title: 'Grove', project: '/repo' } }

    expect(await openDesignStart('/repo', start)).toBe('s-new')

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

    await expect(openDesignStart('/repo', { command: '/design' })).rejects.toThrow('offline')
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
    expect(await prepareDesignStart('s-new', { command: '/design' })).toBe('/design')
    expect(mocks.createArtifact).not.toHaveBeenCalled()
    expect(mocks.installSystem).not.toHaveBeenCalled()
  })

  it('creates the artifact from the template and hands its folder to the skill', async () => {
    expect(await prepareDesignStart('s-new', { command: '/design', template: { id: 'saas', title: 'SaaS landing page', project: '/repo' } }))
      .toBe('/design /repo/dc_artifacts/saas')
    expect(mocks.createArtifact).toHaveBeenCalledWith({ project: '/repo', templateId: 'saas', title: 'SaaS landing page' })
  })

  it('passes the design system to the artifact and does not copy it again for the session', async () => {
    await prepareDesignStart('s-new', { command: '/design', template: { id: 'saas', title: 'SaaS', project: '/repo' }, designSystem: { id: 'paper', name: 'Paper' } })

    expect(mocks.createArtifact).toHaveBeenCalledWith({ project: '/repo', templateId: 'saas', title: 'SaaS', designSystemId: 'paper' })
    expect(mocks.installSystem).not.toHaveBeenCalled()
  })

  it('copies the design system into the session and hands its folder to the skill when there is no template', async () => {
    expect(await prepareDesignStart('s-new', { command: '/slides', designSystem: { id: 'paper', name: 'Paper' } }))
      .toBe('/slides /repo/dc_artifacts/systems/paper')
    expect(mocks.installSystem).toHaveBeenCalledWith('s-new', 'paper')
  })

  it('asks for the clone with the address and creates nothing in the project', async () => {
    expect(await prepareDesignStart('s-new', { command: '/design', cloneAddress: 'https://example.com/' }))
      .toBe(`/design ${t('design.cloneTitle')} https://example.com/`)
    expect(mocks.createArtifact).not.toHaveBeenCalled()
    expect(mocks.installSystem).not.toHaveBeenCalled()
  })

  it('passes a failure to create the artifact on to the caller', async () => {
    mocks.createArtifact.mockRejectedValue(new Error('disk full'))
    await expect(prepareDesignStart('s-new', { command: '/slides', template: { id: 'grove', title: 'Grove', project: '/repo' } })).rejects.toThrow('disk full')
  })
})

describe('typedDesignStart', () => {
  it('turns /slides and /design at the start of the input into a start and keeps the words after them', () => {
    expect(typedDesignStart('/slides', { complete: true })).toEqual({ start: { command: '/slides' }, rest: '' })
    expect(typedDesignStart('/design make a pricing page', { complete: false })).toEqual({ start: { command: '/design' }, rest: 'make a pricing page' })
    expect(typedDesignStart('  /slides\nQ3 results', { complete: false })).toEqual({ start: { command: '/slides' }, rest: 'Q3 results' })
  })

  it('waits for a space after an unfinished command, and leaves other commands and other text alone', () => {
    expect(typedDesignStart('/slides', { complete: false })).toBeNull()
    expect(typedDesignStart('/slidesx', { complete: true })).toBeNull()
    expect(typedDesignStart('/review now', { complete: true })).toBeNull()
    expect(typedDesignStart('make /slides', { complete: true })).toBeNull()
  })

  it('names the commands that have a start, and only those', () => {
    expect(designStartOfCommand('slides')).toEqual({ command: '/slides' })
    expect(designStartOfCommand('design')).toEqual({ command: '/design' })
    expect(designStartOfCommand('review')).toBeNull()
  })
})

describe('designStartLabel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('names the scope, the template or the clone, and the design system', () => {
    expect(designStartLabel({ command: '/slides' }, t)).toBe('Slides')
    expect(designStartLabel({ command: '/slides', template: { id: 'grove', title: 'Grove', project: '/repo' } }, t)).toBe('Slides · Grove')
    expect(designStartLabel({ command: '/design', template: { id: 'saas', title: 'SaaS', project: '/repo' }, designSystem: { id: 'paper', name: 'Paper' } }, t))
      .toBe('Design · SaaS · Design system: Paper')
    expect(designStartLabel({ command: '/design', cloneAddress: 'https://example.com/' }, t)).toBe('Clone example.com')
    expect(designStartLabel({ command: '/design', cloneAddress: 'https://example.com/pricing' }, t)).toBe('Clone example.com/pricing')
  })

  it('follows the language of the app', () => {
    useSettingsStore.setState({ locale: 'zh' })
    expect(designStartLabel({ command: '/slides', template: { id: 'grove', title: 'Grove', project: '/repo' } }, t)).toBe('幻灯片 · Grove')
    expect(designStartLabel({ command: '/design', cloneAddress: 'https://example.com/' }, t)).toBe('复刻 example.com')
  })
})
