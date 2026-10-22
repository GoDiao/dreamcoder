import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'

vi.mock('../components/settings/ProviderSettings', () => ({ ProviderSettings: () => <div>providers page</div> }))
vi.mock('../components/settings/GeneralSettings', () => ({ GeneralSettings: () => <div>general page</div> }))
vi.mock('../components/settings/H5AccessSettings', () => ({ H5AccessSettings: () => null }))
vi.mock('../components/settings/AgentsSettings', () => ({ AgentsSettings: () => null }))
vi.mock('../components/settings/SkillSettings', () => ({ SkillSettings: () => null }))
vi.mock('../components/settings/AboutSettings', () => ({ AboutSettings: () => <div>about page</div> }))
vi.mock('./ComputerUseSettings', () => ({ ComputerUseSettings: () => null }))
vi.mock('./McpSettings', () => ({ McpSettings: () => null }))
vi.mock('./TerminalSettings', () => ({ TerminalSettings: () => null }))
vi.mock('./DiagnosticsSettings', () => ({ DiagnosticsSettings: () => null }))
vi.mock('./ActivitySettings', () => ({ ActivitySettings: () => null }))
vi.mock('./MemorySettings', () => ({ MemorySettings: () => <div>memory page</div> }))
vi.mock('../components/plugins/PluginList', () => ({ PluginList: () => null }))
vi.mock('../components/plugins/PluginDetail', () => ({ PluginDetail: () => null }))

import { SettingsModal } from './SettingsModal'
import { Dropdown } from '../components/shared/Dropdown'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

async function flushSettingsPages() {
  await act(async () => {
    await import('./Settings')
  })
}

function renderWithOpener() {
  return render(
    <>
      <button type="button" onClick={() => useUIStore.getState().openSettings('memory')}>open settings</button>
      <SettingsModal />
    </>,
  )
}

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ settingsOpen: false, settingsTab: 'providers' })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('opens at the requested category and closes on Escape, returning focus to the opener', async () => {
    renderWithOpener()
    const opener = screen.getByRole('button', { name: 'open settings' })
    opener.focus()

    fireEvent.click(opener)
    act(() => { vi.runOnlyPendingTimers() })
    await flushSettingsPages()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('memory page')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Memory' })).toHaveAttribute('aria-current', 'page')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(useUIStore.getState().settingsOpen).toBe(false)
    expect(document.activeElement).toBe(opener)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('falls back to the composer when the opener is gone by the time settings close', () => {
    function DisappearingOpener() {
      const [shown, setShown] = useState(true)
      return (
        <>
          {shown && (
            <button
              type="button"
              onClick={() => {
                useUIStore.getState().openSettings()
                setShown(false)
              }}
            >
              transient opener
            </button>
          )}
          <textarea aria-label="composer" />
          <SettingsModal />
        </>
      )
    }
    render(<DisappearingOpener />)
    const opener = screen.getByRole('button', { name: 'transient opener' })
    opener.focus()
    fireEvent.click(opener)
    act(() => { vi.runOnlyPendingTimers() })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'composer' }))
  })

  it('closes from the close button and the backdrop', () => {
    useUIStore.getState().openSettings()
    renderWithOpener()

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(useUIStore.getState().settingsOpen).toBe(false)

    act(() => { useUIStore.getState().openSettings() })
    const backdrop = screen.getByTestId('settings-overlay').firstElementChild as HTMLElement
    fireEvent.click(backdrop)
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('filters categories by the nav search and clears it when reopened', async () => {
    useUIStore.getState().openSettings()
    renderWithOpener()
    await flushSettingsPages()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'mem' } })

    const nav = screen.getByRole('navigation')
    expect(nav).toHaveTextContent('Memory')
    expect(nav).not.toHaveTextContent('Providers')
    expect(nav).not.toHaveTextContent('About')

    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(200) })
    act(() => { useUIStore.getState().openSettings() })

    expect(screen.getByRole('searchbox', { name: 'Search settings' })).toHaveValue('')
    expect(screen.getByRole('navigation')).toHaveTextContent('Providers')
  })

  it('switches category from the nav', async () => {
    useUIStore.getState().openSettings()
    renderWithOpener()
    await flushSettingsPages()

    fireEvent.click(screen.getByRole('button', { name: 'About' }))

    expect(useUIStore.getState().settingsTab).toBe('about')
    expect(screen.getByText('about page')).toBeInTheDocument()
  })

  it('lets an open dropdown inside the window take Escape first', () => {
    useUIStore.getState().openSettings()
    renderWithOpener()
    render(
      <Dropdown
        items={[{ value: 'a', label: 'Option A' }]}
        value="a"
        onChange={() => {}}
        trigger={<span>pick</span>}
      />,
      { container: screen.getByRole('dialog').appendChild(document.createElement('div')) },
    )

    fireEvent.click(screen.getByText('pick'))
    expect(screen.getByText('Option A')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Option A')).not.toBeInTheDocument()
    expect(useUIStore.getState().settingsOpen).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })
})
