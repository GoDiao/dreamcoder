import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { installSessionPersistence } from '../session/persistence.js'
import { sessionService } from '../services/sessionService.js'
import { conversationService } from '../services/conversationService.js'
import { createSessionState, reduceSessionState } from '../session/state/reducer.js'
import { SessionStateStore } from '../session/state/store.js'
import type { SessionState, SessionStateEvent } from '../session/state/types.js'

function reduce(state: SessionState, ...events: SessionStateEvent[]): SessionState {
  return events.reduce((current, event) => reduceSessionState(current, event).state, state)
}

const request = { requestId: 'req-1', toolName: 'Bash', input: { command: 'ls' } }

const browserGrant = { requestId: 'grant-1', origin: 'https://example.com', action: 'Click element [1]', requestedAt: 7, allowOnce: true, allowSession: true }

describe('session state reducer', () => {
  it('bumps the version and reports only the changed top-level fields', () => {
    const state = createSessionState('s1')
    const { state: next, patch } = reduceSessionState(state, { type: 'permission_desired_changed', mode: 'plan' })

    expect(next.version).toBe(1)
    expect(patch).toEqual({ permission: { desired: 'plan', effective: null } })
  })

  it('returns the same state and an empty patch when nothing changes', () => {
    const state = createSessionState('s1')
    const result = reduceSessionState(state, { type: 'clients_changed', count: 0 })

    expect(result.state).toBe(state)
    expect(result.patch).toEqual({})
  })

  it('keeps the desired mode apart from what the CLI reports', () => {
    const state = reduce(
      createSessionState('s1'),
      { type: 'process_phase_changed', phase: 'running', generation: 1 },
      { type: 'permission_effective_reported', mode: 'default' },
      { type: 'permission_desired_changed', mode: 'bypassPermissions' },
    )

    expect(state.permission).toEqual({ desired: 'bypassPermissions', effective: 'default' })
  })

  it('follows a mode the CLI changes on its own while the two agree', () => {
    const state = reduce(
      createSessionState('s1'),
      { type: 'permission_desired_changed', mode: 'plan' },
      { type: 'permission_effective_reported', mode: 'plan' },
      { type: 'permission_effective_reported', mode: 'acceptEdits' },
    )

    expect(state.permission).toEqual({ desired: 'acceptEdits', effective: 'acceptEdits' })
  })

  it('does not let a fresh process overwrite the chosen mode', () => {
    const state = reduce(
      createSessionState('s1'),
      { type: 'permission_desired_changed', mode: 'default' },
      { type: 'permission_effective_reported', mode: 'bypassPermissions' },
    )

    expect(state.permission).toEqual({ desired: 'default', effective: 'bypassPermissions' })
  })

  it('records a rejected mode change without claiming it took effect', () => {
    const state = reduce(
      createSessionState('s1'),
      { type: 'permission_effective_reported', mode: 'default' },
      { type: 'permission_desired_changed', mode: 'plan' },
      { type: 'permission_change_rejected', mode: 'plan', message: 'not allowed' },
    )

    expect(state.permission).toEqual({ desired: 'plan', effective: 'default' })
    expect(state.process.lastError).toEqual({ code: 'PERMISSION_MODE_REJECTED', message: 'not allowed' })
  })

  it('clears pending requests, the turn and the effective values when the process dies', () => {
    const state = reduce(
      createSessionState('s1'),
      { type: 'process_phase_changed', phase: 'running', generation: 2 },
      { type: 'permission_effective_reported', mode: 'plan' },
      { type: 'runtime_effective_reported', modelId: 'model-a' },
      { type: 'turn_started', at: 10 },
      { type: 'permission_request_opened', request, at: 11 },
      { type: 'process_phase_changed', phase: 'failed', generation: 2, error: { code: 'CLI_EXITED', message: 'boom' } },
    )

    expect(state.pendingPermissions).toEqual([])
    expect(state.turn).toEqual({ phase: 'idle' })
    expect(state.permission.effective).toBeNull()
    expect(state.runtime.effective).toBeNull()
    expect(state.process).toEqual({ phase: 'failed', generation: 2, lastError: { code: 'CLI_EXITED', message: 'boom' } })
  })

  it('ignores lifecycle events from an older process generation', () => {
    const state = reduce(
      createSessionState('s1'),
      { type: 'process_phase_changed', phase: 'running', generation: 3 },
      { type: 'process_phase_changed', phase: 'stopped', generation: 2 },
    )

    expect(state.process.phase).toBe('running')
    expect(state.process.generation).toBe(3)
  })

  it('waits for permission while a request is open and resumes once it closes', () => {
    const opened = reduce(
      createSessionState('s1'),
      { type: 'turn_started', at: 5 },
      { type: 'permission_request_opened', request, at: 6 },
    )
    expect(opened.turn.phase).toBe('awaiting_permission')
    expect(opened.pendingPermissions).toEqual([request])

    const resolved = reduce(opened, { type: 'permission_request_resolved', requestId: 'req-1', allowed: true, by: 'h5' })
    expect(resolved.turn.phase).toBe('running')
    expect(resolved.pendingPermissions).toEqual([])
  })

  it('opens and closes a browser grant without touching the turn', () => {
    const opened = reduce(createSessionState('s1'), { type: 'turn_started', at: 5 }, { type: 'browser_grant_requested', grant: browserGrant })
    expect(opened.pendingBrowserGrants).toEqual([browserGrant])
    expect(opened.turn.phase).toBe('running')

    const closed = reduce(opened, { type: 'browser_grant_closed', requestId: 'grant-1' })
    expect(closed.pendingBrowserGrants).toEqual([])
  })

  it('replaces a browser grant that is opened twice and ignores closing an unknown one', () => {
    const state = reduce(
      createSessionState('s1'),
      { type: 'browser_grant_requested', grant: browserGrant },
      { type: 'browser_grant_requested', grant: { ...browserGrant, allowOnce: false } },
    )
    expect(state.pendingBrowserGrants).toEqual([{ ...browserGrant, allowOnce: false }])

    const result = reduceSessionState(state, { type: 'browser_grant_closed', requestId: 'other' })
    expect(result.patch).toEqual({})
    expect(result.state).toBe(state)
  })

  it('drops pending browser grants when the process ends, starts again or the conversation is cleared', () => {
    const open = reduce(createSessionState('s1'), { type: 'browser_grant_requested', grant: browserGrant })
    expect(reduce(open, { type: 'process_phase_changed', phase: 'stopped', generation: 1 }).pendingBrowserGrants).toEqual([])
    expect(reduce(open, { type: 'process_phase_changed', phase: 'failed', generation: 1 }).pendingBrowserGrants).toEqual([])
    expect(reduce(open, { type: 'process_phase_changed', phase: 'starting', generation: 1 }).pendingBrowserGrants).toEqual([])
    expect(reduce(open, { type: 'conversation_cleared' }).pendingBrowserGrants).toEqual([])
    expect(reduce(open, { type: 'process_phase_changed', phase: 'running', generation: 1 }).pendingBrowserGrants).toEqual([browserGrant])
  })

  it('sets and clears browser activity and reports no change for a repeat', () => {
    const active = reduce(createSessionState('s1'), { type: 'browser_activity_changed', activity: { tabId: 't1' } })
    expect(active.browserActivity).toEqual({ tabId: 't1' })

    const repeated = reduceSessionState(active, { type: 'browser_activity_changed', activity: { tabId: 't1' } })
    expect(repeated.patch).toEqual({})
    expect(repeated.state).toBe(active)

    const moved = reduceSessionState(active, { type: 'browser_activity_changed', activity: { tabId: 't2' } })
    expect(moved.patch).toEqual({ browserActivity: { tabId: 't2' } })

    const cleared = reduceSessionState(active, { type: 'browser_activity_changed', activity: null })
    expect(cleared.patch).toEqual({ browserActivity: null })
  })

  it('drops browser activity when the process ends, starts again or the conversation is cleared', () => {
    const active = reduce(createSessionState('s1'), { type: 'browser_activity_changed', activity: { tabId: 't1' } })
    expect(reduce(active, { type: 'process_phase_changed', phase: 'stopped', generation: 1 }).browserActivity).toBeNull()
    expect(reduce(active, { type: 'process_phase_changed', phase: 'failed', generation: 1 }).browserActivity).toBeNull()
    expect(reduce(active, { type: 'process_phase_changed', phase: 'starting', generation: 1 }).browserActivity).toBeNull()
    expect(reduce(active, { type: 'conversation_cleared' }).browserActivity).toBeNull()
    expect(reduce(active, { type: 'process_phase_changed', phase: 'running', generation: 1 }).browserActivity).toEqual({ tabId: 't1' })
  })

  it('keeps a queued restart until the next process starts', () => {
    const queued = reduce(createSessionState('s1'), { type: 'restart_queued', reason: 'permission' })
    expect(queued.process.pendingRestart).toBe('permission')

    const started = reduce(queued, { type: 'process_phase_changed', phase: 'starting', generation: 1 })
    expect(started.process.pendingRestart).toBeUndefined()
  })

  it('keeps the title through /clear, as the transcript does', () => {
    const state = reduce(
      createSessionState('s1'),
      { type: 'title_changed', text: 'Kept', source: 'custom' },
      { type: 'turn_started', at: 1 },
      { type: 'conversation_cleared' },
    )

    expect(state.title).toEqual({ text: 'Kept', source: 'custom' })
    expect(state.turn).toEqual({ phase: 'idle' })
  })

  it('tracks the active goal from goal events', () => {
    const state = reduce(
      createSessionState('s1'),
      { type: 'goal_reported', goal: { action: 'created', objective: 'ship it' }, at: 1 },
      { type: 'goal_reported', goal: { action: 'completed' }, at: 2 },
    )
    expect(state.activeGoal).toEqual(expect.objectContaining({ action: 'completed', objective: 'ship it', status: 'complete' }))

    expect(reduce(state, { type: 'goal_reported', goal: { action: 'cleared' }, at: 3 }).activeGoal).toBeNull()
  })

  it('keeps running background tasks and only the latest finished ones', () => {
    const events: SessionStateEvent[] = []
    for (let i = 0; i < 30; i++) {
      events.push({ type: 'background_task_reported', task: { taskId: `done-${i}`, status: 'completed' }, at: i })
    }
    events.push({ type: 'background_task_reported', task: { taskId: 'live', status: 'running' }, at: 0 })
    const state = reduce(createSessionState('s1'), ...events)

    expect(state.backgroundTasks.filter((task) => task.status === 'running').map((task) => task.taskId)).toEqual(['live'])
    const finished = state.backgroundTasks.filter((task) => task.status !== 'running').map((task) => task.taskId)
    expect(finished).toHaveLength(20)
    expect(finished.at(-1)).toBe('done-29')
    expect(finished).not.toContain('done-9')
  })

  it('merges background task updates by task id', () => {
    const state = reduce(
      createSessionState('s1'),
      { type: 'background_task_reported', task: { taskId: 't1', status: 'running', description: 'build' }, at: 1 },
      { type: 'background_task_reported', task: { taskId: 't1', status: 'completed' }, at: 4 },
    )

    expect(state.backgroundTasks).toEqual([
      { taskId: 't1', status: 'completed', description: 'build', startedAt: 1, updatedAt: 4 },
    ])
  })
})

describe('session state store', () => {
  const restoredFields = {
    permissionMode: 'plan' as const,
    runtime: null,
    title: { text: 'Saved', source: 'custom' as const },
    workspace: { workDir: '/repo', projectRoot: '/repo', workDirExists: true },
    uiPages: [],
  }

  it('restores persisted fields once and tells subscribers', async () => {
    const store = new SessionStateStore()
    let reads = 0
    store.setRestorer(async () => {
      reads++
      return restoredFields
    })
    const events: string[] = []
    store.subscribe((change) => events.push(change.event.type))

    await store.ensure('s1')
    await store.ensure('s1')

    expect(reads).toBe(1)
    expect(store.get('s1').permission.desired).toBe('plan')
    expect(store.get('s1').title).toEqual({ text: 'Saved', source: 'custom' })
    expect(events).toEqual(['restored'])
  })

  it('keeps a value set while the transcript was still being read', async () => {
    const store = new SessionStateStore()
    let finish: (fields: typeof restoredFields) => void = () => {}
    store.setRestorer(() => new Promise((resolve) => { finish = resolve }))

    const restoring = store.ensure('s1')
    store.apply('s1', { type: 'permission_desired_changed', mode: 'acceptEdits' })
    finish(restoredFields)
    await restoring

    expect(store.get('s1').permission.desired).toBe('acceptEdits')
    expect(store.get('s1').title.text).toBe('Saved')
  })

  it('keeps a value set before the restore started', async () => {
    const store = new SessionStateStore()
    store.setRestorer(async () => restoredFields)

    store.apply('s1', { type: 'permission_desired_changed', mode: 'default' })
    await store.ensure('s1')

    expect(store.get('s1').permission.desired).toBe('default')
  })

  it('does not bring a session back when its restore finishes after it was freed', async () => {
    const store = new SessionStateStore()
    let finish: (fields: typeof restoredFields) => void = () => {}
    store.setRestorer(() => new Promise((resolve) => { finish = resolve }))

    const restoring = store.ensure('s1')
    store.dispose('s1')
    finish(restoredFields)
    await restoring

    expect(store.peek('s1')).toBeUndefined()
  })

  it('applies late updates only to sessions still in memory', () => {
    const store = new SessionStateStore()
    store.applyIfPresent('gone', { type: 'title_changed', text: 'Late', source: 'ai' })
    expect(store.peek('gone')).toBeUndefined()

    store.apply('here', { type: 'clients_changed', count: 1 })
    store.applyIfPresent('here', { type: 'title_changed', text: 'Late', source: 'ai' })
    expect(store.peek('here')?.title.text).toBe('Late')
  })

  it('reads a session that is not in memory without keeping it', async () => {
    const store = new SessionStateStore()
    store.setRestorer(async () => restoredFields)

    const state = await store.read('s9')

    expect(state.permission.desired).toBe('plan')
    expect(store.peek('s9')).toBeUndefined()
  })

  it('does not notify subscribers for events that change nothing', () => {
    const store = new SessionStateStore()
    let calls = 0
    store.subscribe(() => { calls++ })

    store.apply('s1', { type: 'clients_changed', count: 0 })
    store.apply('s1', { type: 'clients_changed', count: 2 })

    expect(calls).toBe(1)
    expect(store.get('s1').version).toBe(1)
  })
})

describe('session persistence', () => {
  afterEach(() => {
    mock.restore()
  })

  it('restores the recorded model and records each change to it', async () => {
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue({
      permissionMode: 'plan',
      runtime: { providerId: 'provider-a', modelId: 'model-a' },
      title: null,
      workDir: '/repo',
      projectRoot: '/repo',
      workDirExists: true,
    })
    const writes: unknown[] = []
    spyOn(sessionService, 'appendSessionRuntimeConfig').mockImplementation(async (_id, runtime) => {
      writes.push(runtime)
    })
    const store = new SessionStateStore()
    const uninstall = installSessionPersistence(store)

    await store.ensure('s1')
    expect(store.get('s1').runtime.desired).toEqual({ providerId: 'provider-a', modelId: 'model-a' })
    expect(writes).toEqual([])

    store.apply('s1', { type: 'runtime_desired_changed', selection: { providerId: 'provider-a', modelId: 'model-a' } })
    store.apply('s1', { type: 'runtime_desired_changed', selection: { providerId: 'provider-b', modelId: 'model-b', effort: 'max' } })
    uninstall()

    expect(writes).toEqual([{ providerId: 'provider-b', modelId: 'model-b', effort: 'max' }])
  })

  it('puts the custom title back only after the CLI process has exited, even when it was killed', async () => {
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue(null)
    const file: string[] = ['custom-title:Renamed']
    spyOn(sessionService, 'restoreCustomTitle').mockImplementation(async (_id, title) => {
      if (file.at(-1) === `custom-title:${title}`) return false
      file.push(`custom-title:${title}`)
      return true
    })
    const store = new SessionStateStore()
    const uninstall = installSessionPersistence(store)

    store.apply('s3', { type: 'title_changed', text: 'Renamed', source: 'custom' })
    store.apply('s3', { type: 'process_phase_changed', phase: 'running', generation: 1 })
    store.apply('s3', { type: 'process_phase_changed', phase: 'stopped', generation: 1 })
    await Bun.sleep(0)
    file.push('custom-title:Stale')
    ;(conversationService as any).emitProcessExited({ sessionId: 's3', generation: 1 })
    await Bun.sleep(0)
    uninstall()

    expect(file).toEqual(['custom-title:Renamed', 'custom-title:Stale', 'custom-title:Renamed'])
  })

  it('falls back to the global default model when the transcript has no record', async () => {
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue({
      permissionMode: 'default',
      title: null,
      workDir: '/repo',
      projectRoot: '/repo',
      workDirExists: true,
    })
    const store = new SessionStateStore()
    const uninstall = installSessionPersistence(store)

    await store.ensure('s2')
    uninstall()

    expect(store.get('s2').runtime.desired).toBeNull()
  })
})
