import type { createBaseHookInput } from '../utils/hooks.js'
import type { getCurrentUsage } from '../utils/tokens.js'
import type { WorktreeSession } from '../utils/worktree.js'
import type { VimMode } from './textInputTypes.js'

type RateLimitWindow = {
  used_percentage: number
  resets_at: number
}

export type StatusLineCommandInput = ReturnType<typeof createBaseHookInput> & {
  session_name?: string
  model: {
    id: string
    display_name: string
  }
  workspace: {
    current_dir: string
    project_dir: string
    added_dirs: string[]
  }
  version: string
  output_style: {
    name: string
  }
  cost: {
    total_cost_usd: number
    total_duration_ms: number
    total_api_duration_ms: number
    total_lines_added: number
    total_lines_removed: number
  }
  context_window: {
    total_input_tokens: number
    total_output_tokens: number
    context_window_size: number
    current_usage: ReturnType<typeof getCurrentUsage>
    used_percentage: number | null
    remaining_percentage: number | null
  }
  exceeds_200k_tokens: boolean
  rate_limits?: {
    five_hour?: RateLimitWindow
    seven_day?: RateLimitWindow
  }
  vim?: {
    mode: VimMode
  }
  agent?: {
    name: string
  }
  remote?: {
    session_id: string
  }
  worktree?: {
    name: WorktreeSession['worktreeName']
    path: WorktreeSession['worktreePath']
    branch: WorktreeSession['worktreeBranch']
    original_cwd: WorktreeSession['originalCwd']
    original_branch: WorktreeSession['originalBranch']
  }
}
