import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LabeledInput } from './LabeledInput'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'
import { Switch } from './ui/switch'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { Dropdown } from './Dropdown'
import { MobileBottomSheet } from './MobileBottomSheet'
import { Toaster } from './ui/sonner'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'

const originalLocale = useSettingsStore.getState().locale
const originalTheme = useUIStore.getState().theme

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  useUIStore.setState({ theme: 'white' })
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  })
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useSettingsStore.setState({ locale: originalLocale })
  useUIStore.setState({ theme: originalTheme })
})

describe('shared components', () => {
  it('associates labels and errors while retaining existing descriptions', () => {
    render(
      <>
        <p id="hint">Use your public name</p>
        <LabeledInput label="Name" error="Name is required" required describedBy="hint" />
      </>
    )
    const control = screen.getByRole('textbox', { name: 'Name' })
    expect(control).toBeRequired()
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAccessibleDescription('Use your public name Name is required')
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required')
  })

  it('prevents repeat activation of a loading button and exposes its state', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    const button = screen.getByRole('button', { name: /Save/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(within(button).queryByRole('status')).toBeNull()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('hides the leading icon of a button while it is loading', () => {
    const hideLeadingIcon = '[&>[data-icon=inline-start]:not([data-slot=spinner])]:hidden'
    const { rerender } = render(<Button><svg data-icon="inline-start" />Refresh</Button>)
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toHaveClass(hideLeadingIcon)
    rerender(<Button loading><svg data-icon="inline-start" />Refresh</Button>)
    const button = screen.getByRole('button', { name: 'Refresh' })
    expect(button).toHaveClass(hideLeadingIcon)
    expect(button.querySelector('[data-slot="spinner"]')).toHaveAttribute('data-icon', 'inline-start')
  })

  it('labels a standalone spinner as a status and hides a decorative one', () => {
    render(<><Spinner /><Spinner aria-hidden="true" data-testid="decorative" /></>)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveAccessibleName()
    expect(screen.getByTestId('decorative')).not.toHaveAttribute('role')
  })

  it('toggles the accessible switch through its controlled value', () => {
    function Harness() {
      const [checked, setChecked] = useState(false)
      return <Switch checked={checked} onCheckedChange={setChecked} aria-label="Notifications" />
    }
    render(<Harness />)
    const control = screen.getByRole('switch', { name: 'Notifications' })
    expect(control).not.toBeChecked()
    fireEvent.click(control)
    expect(control).toBeChecked()
  })

  it('traps dialog focus and returns it to the opener on Escape', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>Edit</button><Modal open={open} onClose={() => setOpen(false)} title="Edit name"><LabeledInput label="Name" /></Modal></>
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Edit' })
    act(() => opener.focus())
    fireEvent.click(opener)
    const input = screen.getByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(input).toHaveFocus())
    act(() => opener.focus())
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('focuses cancel and keeps a confirmation open while its asynchronous action runs', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const props = { open: true, onClose, onConfirm, title: 'Delete file', body: 'This removes the file.', confirmLabel: 'Delete', cancelLabel: 'Cancel' }
    const view = render(<ConfirmDialog {...props} />)
    expect(screen.getByRole('alertdialog', { name: 'Delete file' })).toHaveAccessibleDescription('This removes the file.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    view.rerender(<ConfirmDialog {...props} loading />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('opens a dropdown with the keyboard, selects an item and restores trigger focus', async () => {
    const onChange = vi.fn()
    render(<Dropdown trigger={<button>Provider</button>} value="a" onChange={onChange} items={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} />)
    const trigger = screen.getByRole('button', { name: 'Provider' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const alpha = await screen.findByRole('menuitemradio', { name: 'Alpha' })
    await waitFor(() => expect(alpha).toHaveFocus())
    fireEvent.keyDown(alpha, { key: 'ArrowDown' })
    const beta = screen.getByRole('menuitemradio', { name: 'Beta' })
    await waitFor(() => expect(beta).toHaveFocus())
    fireEvent.keyDown(beta, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('b')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('exposes a labelled mobile drawer and a working close button', () => {
    const onClose = vi.fn()
    render(<MobileBottomSheet open title="Options" onClose={onClose}><button>Choose</button></MobileBottomSheet>)
    expect(screen.getByRole('dialog', { name: 'Options' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows a store toast once in StrictMode and follows the application theme and language', async () => {
    render(<StrictMode><Toaster /></StrictMode>)
    act(() => useUIStore.getState().addToast({ type: 'success', message: 'Saved' }))
    await waitFor(() => expect(screen.getAllByText('Saved')).toHaveLength(1))
    const region = screen.getByRole('region', { name: /Notifications/ })
    expect(region.querySelector('ol')).toHaveAttribute('data-sonner-theme', 'light')
    act(() => {
      useUIStore.setState({ theme: 'midnight' })
      useSettingsStore.setState({ locale: 'zh' })
    })
    expect(region.querySelector('ol')).toHaveAttribute('data-sonner-theme', 'dark')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByText('Saved')).not.toBeInTheDocument())
  })
})
