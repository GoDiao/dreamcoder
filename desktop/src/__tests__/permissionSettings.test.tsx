import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { Settings } from '../pages/Settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

const computerUseApiMock = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getStatus: vi.fn(),
}))

vi.mock('../api/computerUse', () => ({
  computerUseApi: computerUseApiMock,
}))

vi.mock('../stores/providerStore', () => ({
  useProviderStore: () => ({
    providers: [],
    activeId: null,
    hasLoadedProviders: true,
    presets: [],
    isLoading: false,
    isPresetsLoading: false,
    fetchProviders: vi.fn(),
    fetchPresets: vi.fn(),
    deleteProvider: vi.fn(),
    activateProvider: vi.fn(),
    testProvider: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    testConfig: vi.fn(),
  }),
}))

vi.mock('../api/providers', () => ({
  providersApi: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('../stores/agentStore', () => ({
  useAgentStore: () => ({
    activeAgents: [],
    allAgents: [],
    isLoading: false,
    error: null,
    selectedAgent: null,
    fetchAgents: vi.fn(),
    selectAgent: vi.fn(),
  }),
}))

vi.mock('../stores/skillStore', () => ({
  useSkillStore: () => ({
    skills: [],
    selectedSkill: null,
    isLoading: false,
    isDetailLoading: false,
    error: null,
    fetchSkills: vi.fn(),
    fetchSkillDetail: vi.fn(),
    clearSelection: vi.fn(),
  }),
}))

vi.mock('../components/chat/CodeViewer', () => ({
  CodeViewer: ({ code }: { code: string }) => <pre>{code}</pre>,
}))

describe('Settings > Permissions tab', () => {
  beforeEach(() => {
    computerUseApiMock.getConfig.mockReset()
    computerUseApiMock.getStatus.mockReturnValue(new Promise(() => {}))
    useSettingsStore.setState({ locale: 'en', permissionMode: 'default' })
    useUIStore.setState({ settingsTab: 'permissions', toasts: [] })
  })

  it('warns under Bypass permissions when Computer Use is on', async () => {
    computerUseApiMock.getConfig.mockResolvedValue({ enabled: true, driverPath: null })
    render(<Settings />)
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Computer Use actions will no longer ask for confirmation.',
    )
  })

  it('shows no warning when Computer Use is off', async () => {
    computerUseApiMock.getConfig.mockResolvedValue({ enabled: false, driverPath: null })
    render(<Settings />)
    await waitFor(() => expect(computerUseApiMock.getConfig).toHaveBeenCalled())
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})
