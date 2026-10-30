import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNewSessionStore } from './newSessionStore'
import { useSessionStore } from './sessionStore'
import { useChatStore } from './chatStore'
import { useTabStore } from './tabStore'
import { DRAFT_RUNTIME_SELECTION_KEY, useSessionRuntimeStore } from './sessionRuntimeStore'

describe('new session drafts', () => {
  function resetStores() {
    useNewSessionStore.setState(useNewSessionStore.getInitialState(), true)
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    useChatStore.setState(useChatStore.getInitialState(), true)
    useTabStore.setState(useTabStore.getInitialState(), true)
    useSessionRuntimeStore.setState(useSessionRuntimeStore.getInitialState(), true)
  }
  const create = vi.fn<ReturnType<typeof useSessionStore.getState>['createSession']>()
  const connect = vi.fn()
  const send = vi.fn()

  beforeEach(() => {
    resetStores()
    localStorage.clear()
    create.mockReset().mockResolvedValue('created')
    connect.mockReset()
    send.mockReset()
    useSessionStore.setState({ createSession: create })
    useChatStore.setState({ connectToSession: connect, sendMessage: send })
  })

  afterEach(() => {
    resetStores()
    localStorage.clear()
  })

  it('clears the active session when opening the draft', () => {
    useSessionStore.setState({ activeSessionId: 'existing' })
    useNewSessionStore.getState().open()

    expect(useSessionStore.getState().activeSessionId).toBeNull()
  })

  it('repeatedly opens a draft without creating, connecting or inserting a session', () => {
    useTabStore.getState().openTab('__scheduled__', 'Scheduled', 'scheduled')
    useNewSessionStore.getState().open('/project')
    useNewSessionStore.getState().open()

    expect(create).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessions).toEqual([])
    expect(useTabStore.getState().tabs).toHaveLength(1)
    expect(useTabStore.getState().activeTabId).toBeNull()
    expect(useNewSessionStore.getState().workDir).toBe('/project')
    expect(JSON.parse(localStorage.getItem('dreamcoder-open-tabs')!).activeTabId).toBeNull()
  })

  function seedActiveSession(session: { workDir: string; projectRoot?: string }) {
    useSessionStore.setState({
      sessions: [{ id: 'existing', title: 'Existing', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', messageCount: 1, projectPath: '', workDirExists: true, ...session }],
    })
    useTabStore.getState().openTab('existing', 'Existing')
  }

  it('takes the active session work directory when opening an empty draft', () => {
    seedActiveSession({ workDir: '/session/work', projectRoot: '/session/root' })
    useNewSessionStore.getState().open()

    expect(useNewSessionStore.getState().workDir).toBe('/session/work')
  })

  it('falls back to the project root when the active session has no work directory', () => {
    seedActiveSession({ workDir: '', projectRoot: '/session/root' })
    useNewSessionStore.getState().open()

    expect(useNewSessionStore.getState().workDir).toBe('/session/root')
  })

  it('follows the newly active session while the draft is empty', () => {
    seedActiveSession({ workDir: '/p' })
    useNewSessionStore.getState().open()
    useSessionStore.setState((state) => ({ sessions: [...state.sessions, { ...state.sessions[0]!, id: 'other', workDir: '/q' }] }))
    useTabStore.getState().openTab('other', 'Other')
    useNewSessionStore.getState().open()

    expect(useNewSessionStore.getState().workDir).toBe('/q')
  })

  it('keeps a picked directory when opening with no active session', () => {
    useNewSessionStore.getState().open('/picked')
    useNewSessionStore.getState().open()

    expect(useNewSessionStore.getState().workDir).toBe('/picked')
  })

  it('keeps the draft work directory when the draft has input or attachments', () => {
    useNewSessionStore.getState().open('/project')
    useNewSessionStore.getState().updateDraft({ input: 'Unsent question' })
    seedActiveSession({ workDir: '/session/work' })
    useNewSessionStore.getState().open()

    expect(useNewSessionStore.getState().workDir).toBe('/project')

    useNewSessionStore.getState().updateDraft({ input: '', attachments: [{ id: 'file', type: 'file', name: 'a.ts', path: '/project/a.ts' }] })
    useNewSessionStore.getState().open()

    expect(useNewSessionStore.getState().workDir).toBe('/project')
  })

  it('keeps the input, attachments and launch settings when visiting another session', () => {
    useNewSessionStore.getState().open('/project')
    const values = {
      input: 'Unsent question',
      attachments: [{ id: 'file', type: 'file' as const, name: 'a.ts', path: '/project/a.ts' }],
      branch: 'feature',
      useWorktree: true,
      permissionMode: 'plan' as const,
    }
    useNewSessionStore.getState().updateDraft(values)
    useTabStore.getState().openTab('existing', 'Existing')
    useNewSessionStore.getState().open()

    expect(useNewSessionStore.getState()).toMatchObject({ ...values, workDir: '/project' })
    expect(create).not.toHaveBeenCalled()
  })

  it('resets repository-specific choices only when the project changes', () => {
    useNewSessionStore.getState().open('/first')
    useNewSessionStore.getState().updateDraft({ input: 'Question', branch: 'feature', useWorktree: true })
    useNewSessionStore.getState().open('/first')
    expect(useNewSessionStore.getState().branch).toBe('feature')
    useNewSessionStore.getState().open('/second')
    expect(useNewSessionStore.getState()).toMatchObject({ input: 'Question', workDir: '/second', branch: null, useWorktree: false })
    useNewSessionStore.getState().open('')
    expect(useNewSessionStore.getState().workDir).toBe('')
    expect(create).not.toHaveBeenCalled()
  })

  it('does not create a session for a project selection or whitespace alone', async () => {
    useNewSessionStore.getState().open('/project')
    useNewSessionStore.getState().updateDraft({ input: '  \n ' })
    await useNewSessionStore.getState().submit('default', 'New session')
    expect(create).not.toHaveBeenCalled()
  })

  it('creates and sends an attachment-only conversation with its launch settings', async () => {
    useNewSessionStore.getState().open('/project')
    useNewSessionStore.getState().updateDraft({
      attachments: [{ id: 'file', type: 'file', name: 'a.ts', path: '/project/a.ts' }],
      branch: 'feature',
      useWorktree: true,
    })
    useSessionRuntimeStore.getState().setSelection(DRAFT_RUNTIME_SELECTION_KEY, { providerId: 'provider', modelId: 'model' })

    await useNewSessionStore.getState().submit('plan', 'New session')

    expect(create).toHaveBeenCalledExactlyOnceWith('/project', {
      repository: { branch: 'feature', worktree: true },
      permissionMode: 'plan',
      runtime: { providerId: 'provider', modelId: 'model' },
    })
    expect(send).toHaveBeenCalledExactlyOnceWith('created', '', [expect.objectContaining({ type: 'file', path: '/project/a.ts' })])
    expect(useTabStore.getState().activeTabId).toBe('created')
    expect(useNewSessionStore.getState()).toMatchObject({ input: '', attachments: [], createdSessionId: null, isSubmitting: false })
    expect(useSessionRuntimeStore.getState().selections[DRAFT_RUNTIME_SELECTION_KEY]).toBeUndefined()
  })

  it('prevents duplicate creation across remounts and keeps the destination chosen while waiting', async () => {
    let resolveCreate!: (id: string) => void
    create.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve }))
    useNewSessionStore.getState().updateDraft({ input: 'Question' })
    const submitting = useNewSessionStore.getState().submit('default', 'New session')
    useTabStore.getState().openTab('existing', 'Existing')
    useNewSessionStore.getState().open('/another')
    useNewSessionStore.getState().updateDraft({ input: 'Replacement' })
    await useNewSessionStore.getState().submit('default', 'New session')
    useTabStore.getState().openTab('existing', 'Existing')
    resolveCreate('created')
    await submitting

    expect(create).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledExactlyOnceWith('created', 'Question', [])
    expect(useTabStore.getState().activeTabId).toBe('existing')
    expect(useTabStore.getState().tabs.map((tab) => tab.sessionId)).toContain('created')
    expect(useNewSessionStore.getState().isSubmitting).toBe(false)
  })

  it('keeps the full draft and runtime selection after creation fails', async () => {
    create.mockRejectedValueOnce(new Error('unavailable'))
    useNewSessionStore.getState().updateDraft({ input: 'Question', workDir: '/project', branch: 'feature' })
    useSessionRuntimeStore.getState().setSelection(DRAFT_RUNTIME_SELECTION_KEY, { providerId: null, modelId: 'model' })

    await expect(useNewSessionStore.getState().submit('default', 'New session')).rejects.toThrow('unavailable')

    expect(useNewSessionStore.getState()).toMatchObject({ input: 'Question', workDir: '/project', branch: 'feature', createdSessionId: null, isSubmitting: false })
    expect(useSessionRuntimeStore.getState().selections[DRAFT_RUNTIME_SELECTION_KEY]).toEqual({ providerId: null, modelId: 'model' })
    expect(send).not.toHaveBeenCalled()
    await useNewSessionStore.getState().submit('default', 'New session')
    expect(create).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reuses an already-created session when connecting fails before the first send', async () => {
    connect.mockImplementationOnce(() => { throw new Error('connection failed') })
    useNewSessionStore.getState().updateDraft({ input: 'Question', workDir: '/project' })

    await expect(useNewSessionStore.getState().submit('default', 'New session')).rejects.toThrow('connection failed')
    useNewSessionStore.getState().open('/another')
    expect(useNewSessionStore.getState()).toMatchObject({ input: 'Question', workDir: '/project', createdSessionId: 'created', isSubmitting: false })
    await useNewSessionStore.getState().submit('default', 'New session')

    expect(create).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledExactlyOnceWith('created', 'Question', [])
  })
})
