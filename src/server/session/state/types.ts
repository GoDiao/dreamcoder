import type { BackgroundTaskEvent, GoalEventAction } from '../../transcript/classify.js'
import type { ClientKind, PermissionMode } from '../../ws/protocol.js'

export type UiPageSummary = {
  pageId: string
  title: string
  revision: number
}

export type RuntimeSelection = {
  providerId: string | null
  modelId: string
  effort?: string
}

export type SessionSlashCommand = {
  name: string
  description: string
  argumentHint?: string
}

export type SessionRepository = {
  requestedWorkDir: string
  repoRoot: string
  branch: string
  worktree: boolean
  baseRef: string
  worktreePath?: string
  worktreeBranch?: string
  worktreeSlug?: string
}

export type PendingPermission = {
  requestId: string
  toolName: string
  toolUseId?: string
  input: unknown
  description?: string
  suggestions?: unknown[]
}

export type ActiveGoal = {
  action: GoalEventAction
  status?: string
  objective?: string
  budget?: string
  elapsed?: string
  continuations?: string
  message?: string
  updatedAt: number
}

export type BackgroundTaskSummary = BackgroundTaskEvent & {
  startedAt: number
  updatedAt: number
}

export type TitleSource = 'custom' | 'ai' | 'goal' | 'first-message'

export type ProcessPhase = 'stopped' | 'starting' | 'prewarmed' | 'running' | 'restarting' | 'stopping' | 'failed'

export type TurnPhase = 'idle' | 'running' | 'awaiting_permission'

export type TurnActivity = 'thinking' | 'streaming' | 'tool' | 'compacting'

export type RestartReason = 'permission' | 'runtime'

export type ProcessDetail = 'creating_worktree'

export type SessionState = {
  id: string
  version: number
  permission: {
    desired: PermissionMode
    effective: PermissionMode | null
  }
  runtime: {
    desired: RuntimeSelection | null
    effective: { modelId: string | null; effort?: string } | null
  }
  title: { text: string | null; source: TitleSource | null }
  workspace: {
    workDir: string
    projectRoot: string | null
    repository?: SessionRepository
    workDirExists: boolean
  }
  process: {
    phase: ProcessPhase
    generation: number
    pendingRestart?: RestartReason
    detail?: ProcessDetail
    lastError?: { code: string; message: string }
  }
  turn: {
    phase: TurnPhase
    startedAt?: number
    activity?: TurnActivity
  }
  pendingPermissions: PendingPermission[]
  slashCommands: SessionSlashCommand[]
  activeGoal: ActiveGoal | null
  backgroundTasks: BackgroundTaskSummary[]
  uiPages: UiPageSummary[]
  team: { name: string; role: 'lead' | 'member' } | null
  clientCount: number
}

export type SessionStateKey = Exclude<keyof SessionState, 'id' | 'version'>

export type SessionStatePatch = Partial<Pick<SessionState, SessionStateKey>>

export type RestoredSessionFields = {
  permissionMode: PermissionMode
  runtime: RuntimeSelection | null
  title: SessionState['title']
  workspace: SessionState['workspace']
  uiPages: UiPageSummary[]
}

export type SessionStateEvent =
  | { type: 'restored'; fields: RestoredSessionFields }
  | { type: 'permission_desired_changed'; mode: PermissionMode }
  | { type: 'permission_effective_reported'; mode: PermissionMode }
  | { type: 'permission_change_rejected'; mode: PermissionMode; message: string }
  | { type: 'runtime_desired_changed'; selection: RuntimeSelection | null }
  | { type: 'runtime_effective_reported'; modelId: string | null; effort?: string }
  | { type: 'title_changed'; text: string; source: TitleSource }
  | { type: 'workspace_reported'; workspace: Partial<SessionState['workspace']> }
  | { type: 'process_phase_changed'; phase: ProcessPhase; generation: number; error?: { code: string; message: string } }
  | { type: 'restart_queued'; reason: RestartReason }
  | { type: 'restart_cancelled' }
  | { type: 'process_detail_reported'; detail: ProcessDetail | null }
  | { type: 'turn_started'; at: number }
  | { type: 'turn_ended' }
  | { type: 'turn_state_reported'; state: 'running' | 'requires_action' | 'idle'; at: number }
  | { type: 'turn_activity_reported'; activity: TurnActivity }
  | { type: 'permission_request_opened'; request: PendingPermission; at: number }
  | { type: 'permission_request_resolved'; requestId: string; allowed: boolean; by: ClientKind }
  | { type: 'permission_request_cancelled'; requestId: string }
  | { type: 'slash_commands_reported'; commands: SessionSlashCommand[] }
  | { type: 'goal_reported'; goal: Omit<ActiveGoal, 'updatedAt'>; at: number }
  | { type: 'background_task_reported'; task: BackgroundTaskEvent; at: number }
  | { type: 'ui_page_reported'; page: UiPageSummary }
  | { type: 'team_changed'; team: SessionState['team'] }
  | { type: 'clients_changed'; count: number }
  | { type: 'conversation_cleared' }
