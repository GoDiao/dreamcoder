import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../pages/EmptySession', () => ({
  EmptySession: () => <div data-testid="empty-session" />,
}))

vi.mock('../../pages/ActiveSession', () => ({
  ActiveSession: () => <div data-testid="active-session" />,
}))

vi.mock('../../pages/ScheduledTasks', () => ({
  ScheduledTasks: () => <div data-testid="scheduled-tasks" />,
}))

import { ContentRouter } from './ContentRouter'
import { useTabStore } from '../../stores/tabStore'

describe('ContentRouter', () => {
  afterEach(() => {
    cleanup()
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  it('shows the empty session page when nothing is active', () => {
    render(<ContentRouter />)

    expect(screen.getByTestId('empty-session')).toBeInTheDocument()
  })

  it('routes a session tab to the active session page', () => {
    useTabStore.setState({
      tabs: [{ sessionId: 'session-1', title: 'Chat', type: 'session', status: 'idle' }],
      activeTabId: 'session-1',
    })

    render(<ContentRouter />)

    expect(screen.getByTestId('active-session')).toBeInTheDocument()
  })

  it('routes the scheduled tab to scheduled tasks', () => {
    useTabStore.setState({
      tabs: [{ sessionId: '__scheduled__', title: 'Scheduled', type: 'scheduled', status: 'idle' }],
      activeTabId: '__scheduled__',
    })

    render(<ContentRouter />)

    expect(screen.getByTestId('scheduled-tasks')).toBeInTheDocument()
    expect(screen.queryByTestId('active-session')).not.toBeInTheDocument()
  })
})
