import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { create } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderOnboarding } from './ProviderOnboarding'
import type { ProviderPreset } from '../../types/providerPreset'

const DREAMFIELD_PRESET: ProviderPreset = {
  id: 'dreamfield',
  name: 'DreamField',
  baseUrl: 'https://api.dreamfield.top',
  apiFormat: 'anthropic',
  defaultModels: {
    main: 'dreamfield-main',
    haiku: 'dreamfield-haiku',
    sonnet: 'dreamfield-sonnet',
    opus: 'dreamfield-opus',
  },
  needsApiKey: true,
  websiteUrl: 'https://www.dreamfield.top',
}

/** The shape `ProviderOnboarding` reads out of the provider store. */
type StoreState = {
  presets: ProviderPreset[]
  isPresetsLoading: boolean
  fetchPresets: () => Promise<void>
  createProvider: () => Promise<never>
  activateProvider: () => Promise<void>
}

/**
 * Regression cover for the first-run onboarding loop.
 *
 * `ProviderOnboarding` used to call `fetchPresets()` from inside the render
 * body (the `presets.length === 0` branch). `fetchPresets` performs a
 * synchronous `set({ isPresetsLoading: true })` and the component subscribes to
 * the whole store, so that update re-renders it — while `presets` is still
 * empty and the fetch fires again. React eventually aborts with "Maximum update
 * depth exceeded" and the app stays stuck on `Loading...`.
 *
 * A real zustand store is used deliberately: the loop exists only because the
 * hook subscribes to the whole store, which a plain `vi.fn()` would hide. The
 * store stops feeding the loop after a few updates so the call count is
 * observable rather than fatal.
 */
function mountProviderStore(options: { withPresets?: boolean } = {}) {
  let fetchCalls = 0
  const cap = 5

  const useStore = create<StoreState>((set) => ({
    presets: options.withPresets ? [DREAMFIELD_PRESET] : [],
    isPresetsLoading: false,
    fetchPresets: async () => {
      fetchCalls += 1
      if (fetchCalls <= cap) set({ isPresetsLoading: true })
      await Promise.resolve()
    },
    createProvider: async () => {
      throw new Error('not exercised by these tests')
    },
    activateProvider: async () => {},
  }))

  return { useStore, getFetchCalls: () => fetchCalls }
}

vi.mock('../../stores/providerStore', () => ({ useProviderStore: vi.fn() }))
vi.mock('../../stores/settingsStore', () => ({ useSettingsStore: vi.fn() }))

import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'

type SettingsState = ReturnType<typeof useSettingsStore>

describe('ProviderOnboarding', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
    const settingsState = {
      setOnboardingCompleted: vi.fn(),
      fetchAll: vi.fn(),
    } as unknown as SettingsState
    vi.mocked(useSettingsStore).mockImplementation(((selector?: (state: SettingsState) => unknown) =>
      selector ? selector(settingsState) : settingsState) as never)
  })

  afterEach(() => {
    consoleErrorSpy.mockClear()
  })

  /** Wires the real zustand hook (whole-store subscription) into the component. */
  function wireProviderStore(stores: ReturnType<typeof mountProviderStore>) {
    vi.mocked(useProviderStore).mockImplementation(((
      selector?: (state: StoreState) => unknown,
    ) => {
      // Use the hook itself, not getState(): the loop depends on the component
      // subscribing to the whole store and re-rendering on every update.
      const state = selector
        ? (stores.useStore(selector) as unknown as StoreState)
        : (stores.useStore() as unknown as StoreState)
      return state
    }) as never)
  }

  it('requests presets once instead of re-firing on every re-render', async () => {
    const stores = mountProviderStore()
    wireProviderStore(stores)

    render(<ProviderOnboarding />)
    for (let i = 0; i < 10; i++) await act(async () => await Promise.resolve())

    // A single mount effect at most. Anything above 1 is the render-phase loop.
    expect(stores.getFetchCalls()).toBe(1)
  })

  it('keeps the loading state until presets arrive', async () => {
    const stores = mountProviderStore()
    wireProviderStore(stores)

    render(<ProviderOnboarding />)
    await act(async () => await Promise.resolve())

    expect(screen.queryByRole('button', { name: /开始使用/ })).not.toBeInTheDocument()
  })

  it('renders the onboarding form when presets are already loaded', async () => {
    const stores = mountProviderStore({ withPresets: true })
    wireProviderStore(stores)

    render(<ProviderOnboarding />)

    expect(await screen.findByRole('button', { name: /开始使用/ })).toBeInTheDocument()
    expect(screen.queryByText('欢迎使用 DreamCoder')).toBeInTheDocument()
  })
})
