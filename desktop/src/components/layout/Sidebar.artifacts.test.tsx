import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../../lib/desktopRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/desktopRuntime')>()),
  isDesktopRuntime: () => true,
}))

vi.mock('../../api/desktopUiPreferences', () => ({
  desktopUiPreferencesApi: {
    getPreferences: vi.fn().mockResolvedValue({ preferences: { sidebar: {} }, exists: false }),
    updateSidebarPreferences: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../stores/openTargetStore', () => ({
  useOpenTargetStore: { getState: () => ({ ensureTargets: vi.fn(), openTarget: vi.fn(), targets: [] }) },
}))

import { Sidebar } from './Sidebar'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore, ARTIFACTS_TAB_ID } from '../../stores/tabStore'

describe('Sidebar Artifacts entry', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], isLoading: false, error: null, fetchSessions: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState(useSessionStore.getInitialState(), true)
  })

  it('opens the Artifacts page in the main area', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /Artifacts/ }))

    expect(useTabStore.getState().activeTabId).toBe(ARTIFACTS_TAB_ID)
    expect(useTabStore.getState().tabs).toEqual([{ sessionId: ARTIFACTS_TAB_ID, title: 'Artifacts', type: 'artifacts', status: 'idle' }])
  })

  it('is not offered on the mobile sidebar', () => {
    render(<Sidebar isMobile onRequestClose={() => undefined} />)

    expect(screen.queryByRole('button', { name: /Artifacts/ })).not.toBeInTheDocument()
  })
})
