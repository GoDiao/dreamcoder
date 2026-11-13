import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { useDecisionProviderStore } from '../../stores/decisionProviderStore'
import type { DecisionProviderPreset } from '../../types/provider'
import { DecisionProviderFormModal } from './DecisionProviderFormModal'

const presets: DecisionProviderPreset[] = [{
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiFormat: 'openai_decisions',
  models: [{ id: 'gpt-6-luna' }],
}]

describe('DecisionProviderFormModal', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useDecisionProviderStore.setState({
      discoverModels: vi.fn(async () => [{ id: 'decision-model-a' }, { id: 'decision-model-b' }]),
      testConfig: vi.fn(),
      createProvider: vi.fn(),
      updateProvider: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    useDecisionProviderStore.setState(useDecisionProviderStore.getInitialState(), true)
  })

  it('shows discovered models as separate dropdown options', async () => {
    render(<DecisionProviderFormModal open={true} onClose={vi.fn()} presets={presets} />)

    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))

    const modelInput = screen.getByRole('combobox', { name: 'Model ID' })
    await waitFor(() => expect(modelInput).toHaveValue(''))
    fireEvent.focus(modelInput)

    expect(screen.getByRole('option', { name: 'decision-model-a' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'decision-model-b' })).toBeInTheDocument()
    expect(screen.queryByText('decision-model-adecision-model-b')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'decision-model-a' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByText('decision-model-a')).toBeInTheDocument()
  })

  it('keeps a manually configured model even after discovery does not return it', async () => {
    useDecisionProviderStore.setState({
      discoverModels: vi.fn(async () => [{ id: 'gpt-6-luna' }]),
    })
    render(
      <DecisionProviderFormModal
        open={true}
        onClose={vi.fn()}
        presets={presets}
        provider={{
          id: 'openai-decisions',
          presetId: 'openai',
          name: 'OpenAI Decisions',
          deployment: 'hosted',
          apiFormat: 'openai_decisions',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          models: [{ id: 'no-auto-decision-model' }],
        }}
      />,
    )

    expect(screen.getByText('no-auto-decision-model')).toBeInTheDocument()
    expect(screen.queryByText('gpt-6-luna')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Fetch models' })).toBeEnabled())
    expect(screen.getByText('no-auto-decision-model')).toBeInTheDocument()
    expect(screen.queryByText('gpt-6-luna')).not.toBeInTheDocument()
  })
})
