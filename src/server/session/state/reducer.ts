import type {
  ActiveGoal,
  BackgroundTaskSummary,
  SessionState,
  SessionStateEvent,
  SessionStateKey,
  SessionStatePatch,
  UiPageSummary,
} from './types.js'

export function createSessionState(id: string): SessionState {
  return {
    id,
    version: 0,
    permission: { desired: 'default', effective: null },
    runtime: { desired: null, effective: null },
    title: { text: null, source: null },
    workspace: { workDir: '', projectRoot: null, workDirExists: true },
    process: { phase: 'stopped', generation: 0 },
    turn: { phase: 'idle' },
    pendingPermissions: [],
    slashCommands: [],
    activeGoal: null,
    backgroundTasks: [],
    uiPages: [],
    team: null,
    clientCount: 0,
  }
}

export type ReduceResult = {
  state: SessionState
  patch: SessionStatePatch
}

export function reduceSessionState(state: SessionState, event: SessionStateEvent): ReduceResult {
  const next = applyEvent(state, event)
  const patch: SessionStatePatch = {}
  for (const key of Object.keys(next) as Array<keyof SessionState>) {
    if (key === 'id' || key === 'version') continue
    if (!sameValue(state[key], next[key])) {
      ;(patch as Record<SessionStateKey, unknown>)[key] = next[key]
    }
  }
  if (Object.keys(patch).length === 0) return { state, patch }
  return { state: { ...next, version: state.version + 1 }, patch }
}

function applyEvent(state: SessionState, event: SessionStateEvent): SessionState {
  switch (event.type) {
    case 'restored':
      return {
        ...state,
        permission: { ...state.permission, desired: event.fields.permissionMode },
        runtime: { ...state.runtime, desired: event.fields.runtime },
        title: event.fields.title,
        workspace: event.fields.workspace,
        uiPages: event.fields.uiPages.reduce(upsertUiPage, state.uiPages),
      }

    case 'permission_desired_changed': {
      const { lastError: _lastError, ...process } = state.process
      return {
        ...state,
        permission: { ...state.permission, desired: event.mode },
        process: state.process.lastError?.code === 'PERMISSION_MODE_REJECTED' ? process : state.process,
      }
    }

    case 'permission_effective_reported': {
      const inSync = state.permission.effective !== null && state.permission.desired === state.permission.effective
      return {
        ...state,
        permission: {
          desired: inSync ? event.mode : state.permission.desired,
          effective: event.mode,
        },
      }
    }

    case 'permission_change_rejected':
      return {
        ...state,
        process: {
          ...state.process,
          lastError: { code: 'PERMISSION_MODE_REJECTED', message: event.message },
        },
      }

    case 'runtime_desired_changed':
      return { ...state, runtime: { ...state.runtime, desired: event.selection } }

    case 'runtime_effective_reported':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          effective: { modelId: event.modelId, ...(event.effort ? { effort: event.effort } : {}) },
        },
      }

    case 'title_changed':
      return { ...state, title: { text: event.text, source: event.source } }

    case 'workspace_reported':
      return { ...state, workspace: { ...state.workspace, ...event.workspace } }

    case 'process_phase_changed':
      return applyProcessPhase(state, event)

    case 'restart_queued':
      return { ...state, process: { ...state.process, pendingRestart: event.reason } }

    case 'restart_cancelled': {
      const { pendingRestart: _cancelled, ...process } = state.process
      return { ...state, process }
    }

    case 'process_detail_reported': {
      const { detail: _detail, ...process } = state.process
      return { ...state, process: event.detail ? { ...process, detail: event.detail } : process }
    }

    case 'turn_started':
      return { ...state, turn: { phase: 'running', startedAt: event.at, activity: 'thinking' } }

    case 'turn_ended':
      return { ...state, turn: { phase: 'idle' } }

    case 'turn_state_reported':
      if (event.state === 'idle') return { ...state, turn: { phase: 'idle' } }
      if (event.state === 'requires_action') {
        return { ...state, turn: { ...state.turn, phase: 'awaiting_permission', startedAt: state.turn.startedAt ?? event.at } }
      }
      return {
        ...state,
        turn: {
          phase: state.pendingPermissions.length > 0 ? 'awaiting_permission' : 'running',
          startedAt: state.turn.phase === 'idle' ? event.at : state.turn.startedAt ?? event.at,
          activity: state.turn.phase === 'idle' ? 'thinking' : state.turn.activity,
        },
      }

    case 'turn_activity_reported':
      if (state.turn.phase === 'idle') return state
      return { ...state, turn: { ...state.turn, activity: event.activity } }

    case 'permission_request_opened': {
      const others = state.pendingPermissions.filter((request) => request.requestId !== event.request.requestId)
      return {
        ...state,
        pendingPermissions: [...others, event.request],
        turn: { ...state.turn, phase: 'awaiting_permission', startedAt: state.turn.startedAt ?? event.at },
      }
    }

    case 'permission_request_resolved':
    case 'permission_request_cancelled': {
      const pendingPermissions = state.pendingPermissions.filter((request) => request.requestId !== event.requestId)
      if (pendingPermissions.length === state.pendingPermissions.length) return state
      return {
        ...state,
        pendingPermissions,
        turn: pendingPermissions.length === 0 && state.turn.phase === 'awaiting_permission'
          ? { ...state.turn, phase: 'running' }
          : state.turn,
      }
    }

    case 'slash_commands_reported':
      return { ...state, slashCommands: event.commands }

    case 'goal_reported':
      return { ...state, activeGoal: applyGoal(state.activeGoal, event.goal, event.at) }

    case 'background_task_reported':
      return { ...state, backgroundTasks: upsertBackgroundTask(state.backgroundTasks, event.task, event.at) }

    case 'ui_page_reported':
      return { ...state, uiPages: upsertUiPage(state.uiPages, event.page) }

    case 'team_changed':
      return { ...state, team: event.team }

    case 'clients_changed':
      return { ...state, clientCount: event.count }

    case 'conversation_cleared':
      return {
        ...state,
        turn: { phase: 'idle' },
        pendingPermissions: [],
        slashCommands: [],
        activeGoal: null,
        backgroundTasks: [],
      }
  }
}

function applyProcessPhase(
  state: SessionState,
  event: Extract<SessionStateEvent, { type: 'process_phase_changed' }>,
): SessionState {
  if (event.generation < state.process.generation) return state

  const ended = event.phase === 'stopped' || event.phase === 'failed'
  const starting = event.phase === 'starting'
  const process: SessionState['process'] = {
    phase: event.phase,
    generation: event.generation,
    ...(state.process.pendingRestart && !starting ? { pendingRestart: state.process.pendingRestart } : {}),
    ...(state.process.detail && (starting || event.phase === 'restarting') ? { detail: state.process.detail } : {}),
    ...(event.error
      ? { lastError: event.error }
      : state.process.lastError && !starting
        ? { lastError: state.process.lastError }
        : {}),
  }

  if (!ended && !starting) return { ...state, process }

  return {
    ...state,
    process,
    permission: { ...state.permission, effective: null },
    runtime: { ...state.runtime, effective: null },
    turn: { phase: 'idle' },
    pendingPermissions: [],
  }
}

function applyGoal(
  current: ActiveGoal | null,
  goal: Omit<ActiveGoal, 'updatedAt'>,
  updatedAt: number,
): ActiveGoal | null {
  if (goal.action === 'cleared') return null
  if (goal.action === 'message') return current
  const base = goal.action === 'created' || goal.action === 'replaced' ? null : current
  return {
    action: goal.action,
    status: goal.status ?? (goal.action === 'completed' ? 'complete' : base?.status),
    objective: goal.objective ?? base?.objective,
    budget: goal.budget ?? base?.budget,
    elapsed: goal.elapsed ?? base?.elapsed,
    continuations: goal.continuations ?? base?.continuations,
    message: goal.message ?? base?.message,
    updatedAt,
  }
}

function upsertBackgroundTask(
  tasks: BackgroundTaskSummary[],
  task: Extract<SessionStateEvent, { type: 'background_task_reported' }>['task'],
  at: number,
): BackgroundTaskSummary[] {
  const index = tasks.findIndex((existing) =>
    existing.taskId === task.taskId || (!!task.toolUseId && existing.toolUseId === task.toolUseId))
  if (index < 0) return trimFinishedTasks([...tasks, { ...task, startedAt: at, updatedAt: at }])
  const existing = tasks[index]!
  const merged: BackgroundTaskSummary = { ...existing, ...dropUndefined(task), startedAt: existing.startedAt, updatedAt: at }
  return trimFinishedTasks(tasks.map((current, currentIndex) => (currentIndex === index ? merged : current)))
}

const MAX_FINISHED_BACKGROUND_TASKS = 20

function trimFinishedTasks(tasks: BackgroundTaskSummary[]): BackgroundTaskSummary[] {
  const finished = tasks.filter((task) => task.status !== 'running')
  if (finished.length <= MAX_FINISHED_BACKGROUND_TASKS) return tasks
  const dropped = new Set(finished.slice(0, finished.length - MAX_FINISHED_BACKGROUND_TASKS))
  return tasks.filter((task) => !dropped.has(task))
}

function upsertUiPage(pages: UiPageSummary[], page: UiPageSummary): UiPageSummary[] {
  const existing = pages.find((candidate) => candidate.pageId === page.pageId)
  if (!existing) return [...pages, page]
  if (existing.revision > page.revision) return pages
  return pages.map((candidate) => (candidate.pageId === page.pageId ? page : candidate))
}

function dropUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}
