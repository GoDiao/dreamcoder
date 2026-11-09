import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PermissionDialog } from './PermissionDialog'
import { useChatStore } from '../../stores/chatStore'
import { useKanbanStore } from '../../stores/kanbanStore'
import { useSessionStore } from '../../stores/sessionStore'
import { fixtureCard, fixtureView } from '../kanban/kanbanFixture'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

describe('PermissionDialog for the project board', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({ activeTabId: 'pm', tabs: [{ sessionId: 'pm', title: 'PM', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({ sessions: {} })
    const session = (id: string, title: string) => ({ id, title, createdAt: '', modifiedAt: '', messageCount: 1, projectPath: '/repo', projectRoot: '/repo', workDir: '/repo', workDirExists: true })
    useSessionStore.setState({ sessions: [session('pm', 'PM'), session('worker', 'Token worker')] })
    useKanbanStore.setState({ boards: [{ key: 'repo', project: '/repo' }], views: { repo: fixtureView([fixtureCard(3, { title: 'Rotate keys' })], { key: 'repo', project: '/repo' }) } })
  })

  it('names who gets which role on which task, and what changes', () => {
    const { unmount } = render(<PermissionDialog sessionId="pm" requestId="perm-self" toolName="KanbanUpdate" input={{ command: { type: 'assign', card: 3, role: 'reviewer', target: 'self' } }} />)
    expect(screen.getByText('Make this session the reviewer of #3?')).toBeInTheDocument()
    expect(screen.getByText('#3 Rotate keys')).toBeInTheDocument()
    expect(screen.getByText(/reviews what this task delivers/)).toBeInTheDocument()
    unmount()

    render(<PermissionDialog sessionId="pm" requestId="perm-worker" toolName="KanbanUpdate" input={{ command: { type: 'assign', card: 3, role: 'owner', target: { sessionId: 'worker' } } }} />)
    expect(screen.getByText('Make Token worker the owner of #3?')).toBeInTheDocument()
    expect(screen.getByText(/may split it into sub-tasks/)).toBeInTheDocument()
  })

  it('says which task a new session will own or review', () => {
    const { unmount } = render(<PermissionDialog sessionId="pm" requestId="perm-start" toolName="StartSession" input={{ title: 'Keys', prompt: 'go', context: 'fresh', card: 3 }} alwaysAsks />)
    expect(screen.getByText('Start a new session to own #3?')).toBeInTheDocument()
    expect(screen.getByText('#3 Rotate keys')).toBeInTheDocument()
    unmount()

    const review = render(<PermissionDialog sessionId="pm" requestId="perm-review" toolName="StartSession" input={{ title: 'Check', prompt: 'run the tests', context: 'fresh', card: 3, role: 'reviewer' }} alwaysAsks />)
    expect(screen.getByText('Start a new session to review #3?')).toBeInTheDocument()
    review.unmount()

    render(<PermissionDialog sessionId="pm" requestId="perm-plain" toolName="StartSession" input={{ title: 'Keys', prompt: 'go', context: 'fresh' }} alwaysAsks />)
    expect(screen.getByText('Allow Claude to use StartSession?')).toBeInTheDocument()
  })

  it('names the task by its number when the board is not loaded in this window', () => {
    useKanbanStore.setState({ boards: null, views: {} })
    render(<PermissionDialog sessionId="pm" requestId="perm-cancel-unknown" toolName="KanbanUpdate" input={{ command: { type: 'cancel', card: 9 } }} alwaysAsks />)
    expect(screen.getByText('#9')).toBeInTheDocument()
  })

  it('names the task a session wants to cancel and its reason', () => {
    render(<PermissionDialog sessionId="pm" requestId="perm-cancel" toolName="KanbanUpdate" input={{ command: { type: 'cancel', card: 3, reason: 'Covered by #5' } }} alwaysAsks />)
    expect(screen.getByText('Cancel #3?')).toBeInTheDocument()
    expect(screen.getByText('#3 Rotate keys')).toBeInTheDocument()
    expect(screen.getByText('Covered by #5')).toBeInTheDocument()
  })

  it('shows which acceptance criteria an owner wants to add and remove', () => {
    useChatStore.setState({ sessions: { pm: { pendingPermission: { requestId: 'perm-acceptance' } } } as never })
    useKanbanStore.setState({ views: { repo: fixtureView([fixtureCard(3, { title: 'Rotate keys', acceptance: ['Old keys stop working', 'Runs nightly'] })], { key: 'repo', project: '/repo' }) } })
    render(<PermissionDialog sessionId="pm" requestId="perm-acceptance" toolName="KanbanUpdate" input={{ command: { type: 'edit_card', card: 3, acceptance: ['Old keys stop working', 'Runs weekly'] } }} alwaysAsks />)
    expect(screen.getByText('Change the acceptance criteria of #3?')).toBeInTheDocument()
    expect(screen.getByText('#3 Rotate keys')).toBeInTheDocument()
    expect(screen.getByText('Runs weekly').previousElementSibling).toHaveTextContent('Added')
    expect(screen.getByText('Runs nightly').previousElementSibling).toHaveTextContent('Removed')
    expect(screen.getByText('Old keys stop working').previousElementSibling).not.toHaveTextContent(/Added|Removed/)
    expect(screen.getByText(/Allow only a change you agreed on/)).toBeInTheDocument()
  })

  it('shows an answered acceptance change as the list it asked for, not a diff against what the card became later', () => {
    useKanbanStore.setState({ views: { repo: fixtureView([fixtureCard(3, { title: 'Rotate keys', acceptance: ['Old keys stop working', 'Runs weekly', 'Logs each rotation'] })], { key: 'repo', project: '/repo' }) } })
    render(<PermissionDialog sessionId="pm" requestId="perm-acceptance" toolName="KanbanUpdate" input={{ command: { type: 'edit_card', card: 3, acceptance: ['Old keys stop working', 'Runs weekly'] } }} alwaysAsks resolution={{ outcome: 'allowed', remote: false }} />)
    expect(screen.getByText('Runs weekly')).toBeInTheDocument()
    expect(screen.queryByText('Logs each rotation')).not.toBeInTheDocument()
    expect(screen.queryByText('Added')).not.toBeInTheDocument()
    expect(screen.queryByText('Removed')).not.toBeInTheDocument()
  })

  it('shows the suggested task, and says when it also creates the board', () => {
    const { unmount } = render(<PermissionDialog sessionId="pm" requestId="perm-card" toolName="KanbanCreate" input={{ title: 'Rotate keys', description: 'Found while testing' }} />)
    expect(screen.getByText('Add this task to the project board?')).toBeInTheDocument()
    expect(screen.getByText('Rotate keys')).toBeInTheDocument()
    expect(screen.getByText('Found while testing')).toBeInTheDocument()
    unmount()

    render(<PermissionDialog sessionId="pm" requestId="perm-board" toolName="KanbanCreate" input={{ title: 'Plan the release' }} alwaysAsks />)
    expect(screen.getByText('Create the project board with this task?')).toBeInTheDocument()
  })

  it('shows no empty input for a tool that takes none', () => {
    render(<PermissionDialog sessionId="pm" requestId="perm-empty" toolName="SomeTool" input={{}} />)
    expect(screen.queryByText('{}')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show full input' })).not.toBeInTheDocument()
  })

  it('offers to allow for the session only when the answer can be remembered', () => {
    const pending = (requestId: string) => useChatStore.setState({ sessions: { pm: { pendingPermission: { requestId } } } } as never)
    pending('perm-board')
    const { unmount } = render(<PermissionDialog sessionId="pm" requestId="perm-board" toolName="KanbanCreate" input={{ title: 'Plan' }} alwaysAsks />)
    expect(screen.queryByRole('button', { name: /Allow for session/ })).not.toBeInTheDocument()
    unmount()

    pending('perm-card')
    render(<PermissionDialog sessionId="pm" requestId="perm-card" toolName="KanbanCreate" input={{ title: 'Idea' }} />)
    expect(screen.getByRole('button', { name: /Allow for session/ })).toBeInTheDocument()
  })
})

