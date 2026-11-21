import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SavedProvider } from '../../types/provider'
import type { ProviderPreset } from '../../types/providerPreset'

const requests = vi.hoisted(() => [] as Array<{ method: string; path: string }>)

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  const record = (method: string) => async (path: string) => {
    requests.push({ method, path })
    return {}
  }
  return {
    ...actual,
    api: { get: record('GET'), post: record('POST'), put: record('PUT'), patch: record('PATCH'), delete: record('DELETE') },
  }
})

import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ProviderFormModal } from './ProviderFormModal'

const preset: ProviderPreset = {
  id: 'custom',
  name: 'Custom',
  baseUrl: '',
  apiFormat: 'anthropic',
  defaultModels: [],
  needsApiKey: true,
  websiteUrl: '',
}

const secondary: SavedProvider = {
  id: 'secondary',
  presetId: 'custom',
  name: 'Secondary relay',
  apiKey: 'test-key',
  baseUrl: 'https://relay.invalid',
  apiFormat: 'anthropic',
  models: [{ id: 'model-a' }],
}

const originalProviderState = useProviderStore.getState()
const originalSettingsState = useSettingsStore.getState()

afterEach(() => {
  useProviderStore.setState(originalProviderState, true)
  useSettingsStore.setState(originalSettingsState, true)
  requests.length = 0
})

describe('ProviderFormModal and the settings file', () => {
  it('saves a provider that is not the default without reading or writing settings.json', async () => {
    const updateProvider = vi.fn().mockResolvedValue({ provider: secondary })
    useSettingsStore.setState({ locale: 'en', fetchAll: vi.fn().mockResolvedValue(undefined) })
    useProviderStore.setState({ activeId: 'primary', updateProvider })
    render(<ProviderFormModal open={true} onClose={vi.fn()} mode="edit" provider={secondary} presets={[preset]} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(updateProvider).toHaveBeenCalledTimes(1)
    expect(requests.filter(({ path }) => path.startsWith('/api/providers/settings'))).toEqual([])
  })
})
