import { toast } from 'sonner'
import { Toaster } from './ui/sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { UpdateChecker } from './UpdateChecker'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUpdateStore } from '../../stores/updateStore'

describe('UpdateChecker', () => {
  const settings = useSettingsStore.getState()
  const updates = useUpdateStore.getState()
  const shell = Object.getOwnPropertyDescriptor(window, 'dreamcoderShell')
  afterEach(() => {
    cleanup()
    toast.dismiss()
    useSettingsStore.setState(settings, true)
    useUpdateStore.setState(updates, true)
    if (shell) Object.defineProperty(window, 'dreamcoderShell', shell)
    else Reflect.deleteProperty(window, 'dreamcoderShell')
  })
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    Object.defineProperty(window, 'dreamcoderShell', {
      value: {},
      configurable: true,
    })

    useUpdateStore.setState({
      status: 'available',
      availableVersion: '0.1.5',
      releaseNotes: '# DreamCoder v0.1.5\n\n[Release notes](https://example.com/releases/v0.1.5)',
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })
  })

  it('renders markdown release notes in the update prompt', async () => {
    render(<><Toaster /><UpdateChecker /></>)

    expect(await screen.findByText('v0.1.5 available')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'DreamCoder v0.1.5' })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Release notes' })
    expect(link).toHaveAttribute('href', 'https://example.com/releases/v0.1.5')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows downloaded bytes when the updater does not provide total size', async () => {
    useUpdateStore.setState({
      status: 'downloading',
      availableVersion: '0.1.5',
      releaseNotes: '# DreamCoder v0.1.5',
      progressPercent: 0,
      downloadedBytes: 1536,
      totalBytes: null,
      error: null,
      checkedAt: null,
      shouldPrompt: true,
      initialize: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      dismissPrompt: vi.fn(),
    })

    render(<><Toaster /><UpdateChecker /></>)

    expect(await screen.findByText('Downloading update... 1.5 KB downloaded')).toBeInTheDocument()
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'indeterminate')
  })
})

it('updates one nonmodal notification and removes it when dismissed', async () => {
  const previous = useUpdateStore.getState()
  const shell = Object.getOwnPropertyDescriptor(window, 'dreamcoderShell')
  const settings = useSettingsStore.getState()
  Object.defineProperty(window, 'dreamcoderShell', { value: {}, configurable: true })
  useSettingsStore.setState({ locale: 'en' })
  const install = vi.fn()
  useUpdateStore.setState({ ...previous, initialize: vi.fn(), status: 'available', availableVersion: '1.2.3', shouldPrompt: true, releaseNotes: '', installUpdate: install, dismissPrompt: () => useUpdateStore.setState({ shouldPrompt: false }) })
  try {
    render(<><Toaster /><UpdateChecker /></>)
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }))
    expect(install).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useUpdateStore.setState({ status: 'downloading', totalBytes: 100, progressPercent: 30 }))
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '30')
    expect(screen.getAllByText('v1.2.3 available')).toHaveLength(1)
    act(() => useUpdateStore.setState({ status: 'available' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }))
    await waitFor(() => expect(screen.queryByText('v1.2.3 available')).not.toBeInTheDocument())
  } finally {
    cleanup()
    toast.dismiss()
    useUpdateStore.setState(previous, true)
    useSettingsStore.setState(settings, true)
    if (shell) Object.defineProperty(window, 'dreamcoderShell', shell)
    else Reflect.deleteProperty(window, 'dreamcoderShell')
  }
})
