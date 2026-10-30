import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/dom'
import { App } from './App'
import { Tooltip } from './components/shared/Tooltip'
import { useUIStore } from './stores/uiStore'

vi.mock('./components/layout/AppShell', () => ({
  AppShell: () => <Tooltip content="Full path"><button>Project</button></Tooltip>,
}))

vi.mock('./hooks/useScheduledTaskDesktopNotifications', () => ({
  useScheduledTaskDesktopNotifications: vi.fn(),
}))

vi.mock('./lib/desktopNotificationNavigation', () => ({
  installDesktopNotificationNavigation: vi.fn(async () => () => {}),
}))

describe('App', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('provides the tooltip context for the whole app', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<App />))
    const trigger = screen.getByRole('button', { name: 'Project' })
    act(() => trigger.focus())
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Full path'))
  })

  it('shows toasts on every screen of the app', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<App />))
    act(() => useUIStore.getState().addToast({ type: 'error', message: 'Connection failed' }))
    await waitFor(() => expect(screen.getByText('Connection failed')).toBeInTheDocument())
  })
})
