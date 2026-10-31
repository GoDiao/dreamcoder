import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const listTrustedBrowserOrigins = vi.hoisted(() => vi.fn())
const trustBrowserOrigin = vi.hoisted(() => vi.fn())
const untrustBrowserOrigin = vi.hoisted(() => vi.fn())

vi.mock('../../lib/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/shell')>()),
  listTrustedBrowserOrigins,
  trustBrowserOrigin,
  untrustBrowserOrigin,
}))

import { BrowserTrustSettings } from './BrowserTrustSettings'
import { useSettingsStore } from '../../stores/settingsStore'

describe('BrowserTrustSettings', () => {
  beforeEach(() => {
    listTrustedBrowserOrigins.mockReset()
    trustBrowserOrigin.mockReset()
    untrustBrowserOrigin.mockReset()
    listTrustedBrowserOrigins.mockResolvedValue(['https://a.test', 'https://b.test'])
    useSettingsStore.setState({ locale: 'en' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    vi.restoreAllMocks()
  })

  it('lists the trusted origins', async () => {
    render(<BrowserTrustSettings />)

    expect(await screen.findByText('https://a.test')).toBeInTheDocument()
    expect(screen.getByText('https://b.test')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows the empty state when nothing is trusted', async () => {
    listTrustedBrowserOrigins.mockResolvedValue([])
    render(<BrowserTrustSettings />)

    expect(await screen.findByText(/No trusted sites/)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows a loading state, then an error with a retry that reloads the list', async () => {
    listTrustedBrowserOrigins.mockRejectedValueOnce(new Error('the sidecar is not connected'))
    render(<BrowserTrustSettings />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the trusted sites.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('https://a.test')).toBeInTheDocument()
    expect(listTrustedBrowserOrigins).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('adds an origin, shows the list the server returns and clears the input', async () => {
    trustBrowserOrigin.mockResolvedValue(['https://a.test', 'https://b.test', 'https://c.test'])
    render(<BrowserTrustSettings />)
    await screen.findByText('https://a.test')

    const input = screen.getByLabelText('Site to trust')
    fireEvent.change(input, { target: { value: '  https://c.test  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('https://c.test')).toBeInTheDocument()
    expect(trustBrowserOrigin).toHaveBeenCalledWith('https://c.test')
    expect(input).toHaveValue('')
  })

  it('keeps Add disabled for an empty input', async () => {
    render(<BrowserTrustSettings />)
    await screen.findByText('https://a.test')

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it.each([
    ['invalid_origin', 'Enter an exact https origin such as https://example.com, without wildcards, paths, credentials or other schemes.'],
    ['limit', 'The trusted-site list is full. Remove a site first.'],
    ['unavailable', 'The trusted-site list is not available right now.'],
    ['internal', 'Could not update the trusted sites. Try again.'],
    ['the sidecar is not connected', 'Could not update the trusted sites. Try again.'],
  ])('shows the localized message for the %s error and keeps the input', async (code, message) => {
    trustBrowserOrigin.mockRejectedValue(new Error(code))
    render(<BrowserTrustSettings />)
    await screen.findByText('https://a.test')

    const input = screen.getByLabelText('Site to trust')
    fireEvent.change(input, { target: { value: 'https://*.c.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(input).toHaveValue('https://*.c.test')
    expect(screen.getByText('https://a.test')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'https://c.test' } })
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })

  it('shows the validation error in Chinese', async () => {
    useSettingsStore.setState({ locale: 'zh' })
    trustBrowserOrigin.mockRejectedValue(new Error('invalid_origin'))
    render(<BrowserTrustSettings />)
    await screen.findByText('https://a.test')

    fireEvent.change(screen.getByLabelText('要信任的网站'), { target: { value: 'http://c.test' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    expect(await screen.findByText(/请输入精确的 https 来源/)).toBeInTheDocument()
  })

  it('removes an origin and shows the list the server returns', async () => {
    untrustBrowserOrigin.mockResolvedValue(['https://b.test'])
    render(<BrowserTrustSettings />)
    await screen.findByText('https://a.test')

    fireEvent.click(screen.getByRole('button', { name: 'Remove https://a.test' }))

    await waitFor(() => expect(screen.queryByText('https://a.test')).not.toBeInTheDocument())
    expect(untrustBrowserOrigin).toHaveBeenCalledWith('https://a.test')
    expect(screen.getByText('https://b.test')).toBeInTheDocument()
  })

  it('keeps the list and shows an error when removing fails', async () => {
    untrustBrowserOrigin.mockRejectedValue(new Error('unavailable'))
    render(<BrowserTrustSettings />)
    await screen.findByText('https://a.test')

    fireEvent.click(screen.getByRole('button', { name: 'Remove https://a.test' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The trusted-site list is not available right now.')
    expect(screen.getByText('https://a.test')).toBeInTheDocument()
  })
})
