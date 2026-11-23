export type Terminal =
  | {
      reason:
        | 'blocking_limit'
        | 'image_error'
        | 'aborted_streaming'
        | 'completed'
        | 'stop_hook_prevented'
        | 'aborted_tools'
        | 'hook_stopped'
    }
  | { reason: 'model_error'; error: unknown }
  | { reason: 'max_turns'; turnCount: number }

export type Continue =
  | {
      reason:
        | 'max_output_tokens_escalate'
        | 'stop_hook_blocking'
        | 'token_budget_continuation'
        | 'next_turn'
    }
  | { reason: 'max_output_tokens_recovery'; attempt: number }
