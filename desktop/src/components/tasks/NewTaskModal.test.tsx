import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { NewTaskModal } from './NewTaskModal'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTaskStore } from '../../stores/taskStore'

afterEach(() => {
  cleanup()
  useProviderStore.setState(useProviderStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useTaskStore.setState(useTaskStore.getInitialState(), true)
})

describe('NewTaskModal', () => {
  it('creates scheduled tasks with a provider-scoped model selection', async () => {
    const createTask = vi.fn(async () => {})
    useTaskStore.setState({ createTask } as Partial<ReturnType<typeof useTaskStore.getState>>)
    useSettingsStore.setState({
      locale: 'en',
      currentModel: {
        id: 'provider-main',
        name: 'provider-main',
        description: '',
        context: '',
      },
      availableModels: [
        { id: 'provider-main', name: 'provider-main', description: 'Main model', context: '' },
        { id: 'provider-fast', name: 'provider-fast', description: 'Haiku model', context: '' },
      ],
      activeProviderName: 'Provider A',
    })
    useProviderStore.setState({
      providers: [{
        id: 'provider-a',
        presetId: 'custom',
        name: 'Provider A',
        apiKey: '***',
        baseUrl: 'https://api.example.com',
        apiFormat: 'anthropic',
        models: [{ id: 'provider-main' }, { id: 'provider-fast' }],
        fastModel: 'provider-fast',
      }],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })

    render(<NewTaskModal open onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: 'provider cron' },
    })
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'exercise provider selection' },
    })
    fireEvent.change(screen.getByPlaceholderText(/Look at the commits/i), {
      target: { value: 'Say hello from the scheduled task.' },
    })

    const modelSelect = screen.getByRole('combobox', { name: /^Select model/ })
    act(() => modelSelect.focus())
    fireEvent.keyDown(modelSelect, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: /provider-fast/i }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
      await Promise.resolve()
    })

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      model: 'provider-fast',
      providerId: 'provider-a',
      enabled: true,
      recurring: true,
    }))
  })

  it('starts a new task in the default for new sessions and saves that mode with it', async () => {
    const createTask = vi.fn(async () => {})
    useTaskStore.setState({ createTask } as Partial<ReturnType<typeof useTaskStore.getState>>)
    useSettingsStore.setState({ locale: 'en', permissionMode: 'acceptEdits' })

    render(<NewTaskModal open onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Accept edits' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'mode task' } })
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'mode' } })
    fireEvent.change(screen.getByPlaceholderText(/Look at the commits/i), { target: { value: 'Say hello.' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
      await Promise.resolve()
    })

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'acceptEdits' }))
  })

  it('saves a mode picked for the task', async () => {
    const createTask = vi.fn(async () => {})
    useTaskStore.setState({ createTask } as Partial<ReturnType<typeof useTaskStore.getState>>)
    useSettingsStore.setState({ locale: 'en', permissionMode: 'acceptEdits' })

    render(<NewTaskModal open onClose={vi.fn()} />)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Accept edits' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Plan/ }))
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'mode task' } })
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'mode' } })
    fireEvent.change(screen.getByPlaceholderText(/Look at the commits/i), { target: { value: 'Say hello.' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
      await Promise.resolve()
    })

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'plan' }))
  })

})

async function chooseOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

it.each([
  ['Every N minutes', 'Every N minutes', 'Every 10 minutes', '*/10 * * * *'],
  ['Every N hours', 'Every N hours', 'Every 2 hours', '0 */2 * * *'],
  ['Monthly', 'Day of month', 'On day 28 of each month', '0 9 28 * *'],
] as const)('saves %s from the shared selects with desktop notifications', async (frequency, label, option, cron) => {
  const createTask = vi.fn(async () => {})
  useTaskStore.setState({ createTask })
  useSettingsStore.setState({ locale: 'en' })
  render(<NewTaskModal open onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Test task' } })
  fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Test schedule' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Task prompt' }), { target: { value: 'Test prompt' } })
  await chooseOption('Frequency', frequency)
  await chooseOption(label, option)
  const checkbox = screen.getByRole('checkbox')
  expect(checkbox).not.toBeChecked()
  fireEvent.click(checkbox)
  expect(checkbox).toBeChecked()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create task' })) })
  expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ cron, prompt: 'Test prompt', notification: { enabled: true, channels: ['desktop'] } }))
})

it('preserves the time input and rejects invalid custom cron after changing frequency', async () => {
  useSettingsStore.setState({ locale: 'en' })
  render(<NewTaskModal open onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Test task' } })
  fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Test schedule' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Task prompt' }), { target: { value: 'Test prompt' } })
  expect(screen.getByLabelText('Run time')).toHaveAttribute('type', 'time')
  await chooseOption('Frequency', 'Custom cron expression')
  const input = screen.getByRole('textbox', { name: 'Custom cron expression' })
  fireEvent.change(input, { target: { value: 'invalid' } })
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled()
})

it('labels the frequency select with a visible label tied to the control', () => {
  useSettingsStore.setState({ locale: 'en' })
  render(<NewTaskModal open onClose={() => {}} />)
  const label = screen.getByText('Frequency', { selector: 'label' })
  expect(label).toHaveAttribute('for', screen.getByRole('combobox', { name: 'Frequency' }).id)
})
