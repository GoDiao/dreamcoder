/**
 * SDK Control Schemas - Zod schemas for the control protocol.
 *
 * These schemas define the control protocol between SDK implementations and the CLI.
 * Used by SDK builders (e.g., Python SDK) to communicate with the CLI process.
 *
 * SDK consumers should use coreSchemas.ts instead.
 */

import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  AccountInfoSchema,
  AgentDefinitionSchema,
  AgentInfoSchema,
  FastModeStateSchema,
  HookEventSchema,
  HookInputSchema,
  McpServerConfigForProcessTransportSchema,
  McpServerStatusSchema,
  ModelInfoSchema,
  PermissionModeSchema,
  PermissionUpdateSchema,
  SDKMessageSchema,
  SDKPostTurnSummaryMessageSchema,
  SDKStreamlinedTextMessageSchema,
  SDKStreamlinedToolUseSummaryMessageSchema,
  SDKUserMessageSchema,
  SlashCommandSchema,
} from './coreSchemas.js'

// ============================================================================
// External Type Placeholders
// ============================================================================

// JSONRPCMessage from @modelcontextprotocol/sdk - treat as unknown
export const JSONRPCMessagePlaceholder = lazySchema(() => z.unknown())

// ============================================================================
// Hook Callback Types
// ============================================================================

export const SDKHookCallbackMatcherSchema = lazySchema(() =>
  z
    .object({
      matcher: z.string().optional(),
      hookCallbackIds: z.array(z.string()),
      timeout: z.number().optional(),
    })
    .describe('Configuration for matching and routing hook callbacks.'),
)

// ============================================================================
// Control Request Types
// ============================================================================

export const SDKControlInitializeRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('initialize'),
      hooks: z
        .record(HookEventSchema(), z.array(SDKHookCallbackMatcherSchema()))
        .optional(),
      sdkMcpServers: z.array(z.string()).optional(),
      jsonSchema: z.record(z.string(), z.unknown()).optional(),
      systemPrompt: z.string().optional(),
      appendSystemPrompt: z.string().optional(),
      agents: z.record(z.string(), AgentDefinitionSchema()).optional(),
      promptSuggestions: z.boolean().optional(),
      agentProgressSummaries: z.boolean().optional(),
    })
    .describe(
      'Initializes the SDK session with hooks, MCP servers, and agent configuration.',
    ),
)

export const SDKControlInitializeResponseSchema = lazySchema(() =>
  z
    .object({
      commands: z.array(SlashCommandSchema()),
      agents: z.array(AgentInfoSchema()),
      output_style: z.string(),
      available_output_styles: z.array(z.string()),
      models: z.array(ModelInfoSchema()),
      account: AccountInfoSchema(),
      pid: z
        .number()
        .optional()
        .describe('@internal CLI process PID for tmux socket isolation'),
      fast_mode_state: FastModeStateSchema().optional(),
    })
    .describe(
      'Response from session initialization with available commands, models, and account info.',
    ),
)

export const SDKControlInterruptRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('interrupt'),
    })
    .describe('Interrupts the currently running conversation turn.'),
)


export const SDKControlPermissionRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('can_use_tool'),
      tool_name: z.string(),
      input: z.record(z.string(), z.unknown()),
      permission_suggestions: z.array(PermissionUpdateSchema()).optional(),
      blocked_path: z.string().optional(),
      decision_reason: z.string().optional(),
      title: z.string().optional(),
      display_name: z.string().optional(),
      tool_use_id: z.string(),
      agent_id: z.string().optional(),
      description: z.string().optional(),
      always_asks: z
        .boolean()
        .optional()
        .describe('The tool asks every time: an allow rule for it is ignored, so the host should not offer to remember the answer.'),
    })
    .describe('Requests permission to use a tool with the given input.'),
)

export const SDKControlSetPermissionModeRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_permission_mode'),
      mode: PermissionModeSchema(),
      ultraplan: z
        .boolean()
        .optional()
        .describe('@internal CCR ultraplan session marker.'),
    })
    .describe('Sets the permission mode for tool execution handling.'),
)

export const SDKControlSetModelRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_model'),
      model: z.string().optional(),
    })
    .describe('Sets the model to use for subsequent conversation turns.'),
)

export const SDKControlSetMaxThinkingTokensRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_max_thinking_tokens'),
      max_thinking_tokens: z.number().nullable(),
    })
    .describe(
      'Sets the maximum number of thinking tokens for extended thinking.',
    ),
)

export const SDKControlMcpStatusRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_status'),
    })
    .describe('Requests the current status of all MCP server connections.'),
)

export const SDKControlMcpStatusResponseSchema = lazySchema(() =>
  z
    .object({
      mcpServers: z.array(McpServerStatusSchema()),
    })
    .describe(
      'Response containing the current status of all MCP server connections.',
    ),
)

export const SDKControlGetContextUsageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_context_usage'),
      estimateOnly: z.boolean().optional(),
    })
    .describe(
      'Requests a breakdown of current context window usage by category.',
    ),
)

export const SDKControlGetSessionUsageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_session_usage'),
    })
    .describe('Requests accumulated cost and token usage for the current session.'),
)

export const SDKControlGetSessionUsageResponseSchema = lazySchema(() =>
  z
    .object({
      totalCostUSD: z.number(),
      costDisplay: z.string(),
      hasUnknownModelCost: z.boolean(),
      totalAPIDuration: z.number(),
      totalDuration: z.number(),
      totalLinesAdded: z.number(),
      totalLinesRemoved: z.number(),
      totalInputTokens: z.number(),
      totalOutputTokens: z.number(),
      totalCacheReadInputTokens: z.number(),
      totalCacheCreationInputTokens: z.number(),
      totalWebSearchRequests: z.number(),
      models: z.array(
        z.object({
          model: z.string(),
          displayName: z.string(),
          inputTokens: z.number(),
          outputTokens: z.number(),
          cacheReadInputTokens: z.number(),
          cacheCreationInputTokens: z.number(),
          webSearchRequests: z.number(),
          costUSD: z.number(),
          costDisplay: z.string(),
          contextWindow: z.number(),
          maxOutputTokens: z.number(),
        }),
      ),
    })
    .describe('Accumulated cost, duration, code change, and model usage data.'),
)

const ContextCategorySchema = lazySchema(() =>
  z.object({
    name: z.string(),
    tokens: z.number(),
    color: z.string(),
    isDeferred: z.boolean().optional(),
  }),
)

const ContextGridSquareSchema = lazySchema(() =>
  z.object({
    color: z.string(),
    isFilled: z.boolean(),
    categoryName: z.string(),
    tokens: z.number(),
    percentage: z.number(),
    squareFullness: z.number(),
  }),
)

export const SDKControlGetContextUsageResponseSchema = lazySchema(() =>
  z
    .object({
      categories: z.array(ContextCategorySchema()),
      totalTokens: z.number(),
      maxTokens: z.number(),
      rawMaxTokens: z.number(),
      percentage: z.number(),
      gridRows: z.array(z.array(ContextGridSquareSchema())),
      model: z.string(),
      memoryFiles: z.array(
        z.object({
          path: z.string(),
          type: z.string(),
          tokens: z.number(),
        }),
      ),
      mcpTools: z.array(
        z.object({
          name: z.string(),
          serverName: z.string(),
          tokens: z.number(),
          isLoaded: z.boolean().optional(),
        }),
      ),
      deferredBuiltinTools: z
        .array(
          z.object({
            name: z.string(),
            tokens: z.number(),
            isLoaded: z.boolean(),
          }),
        )
        .optional(),
      systemTools: z
        .array(z.object({ name: z.string(), tokens: z.number() }))
        .optional(),
      systemPromptSections: z
        .array(z.object({ name: z.string(), tokens: z.number() }))
        .optional(),
      agents: z.array(
        z.object({
          agentType: z.string(),
          source: z.string(),
          tokens: z.number(),
        }),
      ),
      slashCommands: z
        .object({
          totalCommands: z.number(),
          includedCommands: z.number(),
          tokens: z.number(),
        })
        .optional(),
      skills: z
        .object({
          totalSkills: z.number(),
          includedSkills: z.number(),
          tokens: z.number(),
          skillFrontmatter: z.array(
            z.object({
              name: z.string(),
              source: z.string(),
              tokens: z.number(),
            }),
          ),
        })
        .optional(),
      autoCompactThreshold: z.number().optional(),
      isAutoCompactEnabled: z.boolean(),
      messageBreakdown: z
        .object({
          toolCallTokens: z.number(),
          toolResultTokens: z.number(),
          attachmentTokens: z.number(),
          assistantMessageTokens: z.number(),
          userMessageTokens: z.number(),
          toolCallsByType: z.array(
            z.object({
              name: z.string(),
              callTokens: z.number(),
              resultTokens: z.number(),
            }),
          ),
          attachmentsByType: z.array(
            z.object({ name: z.string(), tokens: z.number() }),
          ),
        })
        .optional(),
      apiUsage: z
        .object({
          input_tokens: z.number(),
          output_tokens: z.number(),
          cache_creation_input_tokens: z.number(),
          cache_read_input_tokens: z.number(),
        })
        .nullable(),
    })
    .describe(
      'Breakdown of current context window usage by category (system prompt, tools, messages, etc.).',
    ),
)

export const SDKControlRewindFilesRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('rewind_files'),
      user_message_id: z.string(),
      dry_run: z.boolean().optional(),
    })
    .describe('Rewinds file changes made since a specific user message.'),
)

export const SDKControlRewindFilesResponseSchema = lazySchema(() =>
  z
    .object({
      canRewind: z.boolean(),
      error: z.string().optional(),
      filesChanged: z.array(z.string()).optional(),
      insertions: z.number().optional(),
      deletions: z.number().optional(),
    })
    .describe('Result of a rewindFiles operation.'),
)

export const SDKControlCancelAsyncMessageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('cancel_async_message'),
      message_uuid: z.string(),
    })
    .describe(
      'Drops a pending async user message from the command queue by uuid. No-op if already dequeued for execution.',
    ),
)

export const SDKControlCancelAsyncMessageResponseSchema = lazySchema(() =>
  z
    .object({
      cancelled: z.boolean(),
    })
    .describe(
      'Result of a cancel_async_message operation. cancelled=false means the message was not in the queue (already dequeued or never enqueued).',
    ),
)

export const SDKControlSeedReadStateRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('seed_read_state'),
      path: z.string(),
      mtime: z.number(),
    })
    .describe(
      'Seeds the readFileState cache with a path+mtime entry. Use when a prior Read was removed from context (e.g. by snip) so Edit validation would fail despite the client having observed the Read. The mtime lets the CLI detect if the file changed since the seeded Read — same staleness check as the normal path.',
    ),
)

export const SDKHookCallbackRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('hook_callback'),
      callback_id: z.string(),
      input: HookInputSchema(),
      tool_use_id: z.string().optional(),
    })
    .describe('Delivers a hook callback with its input data.'),
)

export const SDKControlMcpMessageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_message'),
      server_name: z.string(),
      message: JSONRPCMessagePlaceholder(),
    })
    .describe('Sends a JSON-RPC message to a specific MCP server.'),
)

export const SDKControlMcpSetServersRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_set_servers'),
      servers: z.record(z.string(), McpServerConfigForProcessTransportSchema()),
    })
    .describe('Replaces the set of dynamically managed MCP servers.'),
)

export const SDKControlMcpSetServersResponseSchema = lazySchema(() =>
  z
    .object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
      errors: z.record(z.string(), z.string()),
    })
    .describe(
      'Result of replacing the set of dynamically managed MCP servers.',
    ),
)

export const SDKControlReloadPluginsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('reload_plugins'),
    })
    .describe(
      'Reloads plugins from disk and returns the refreshed session components.',
    ),
)

export const SDKControlReloadPluginsResponseSchema = lazySchema(() =>
  z
    .object({
      commands: z.array(SlashCommandSchema()),
      agents: z.array(AgentInfoSchema()),
      plugins: z.array(
        z.object({
          name: z.string(),
          path: z.string(),
          source: z.string().optional(),
        }),
      ),
      mcpServers: z.array(McpServerStatusSchema()),
      error_count: z.number(),
    })
    .describe(
      'Refreshed commands, agents, plugins, and MCP server status after reload.',
    ),
)

export const SDKControlMcpReconnectRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_reconnect'),
      serverName: z.string(),
    })
    .describe('Reconnects a disconnected or failed MCP server.'),
)

export const SDKControlMcpToggleRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_toggle'),
      serverName: z.string(),
      enabled: z.boolean(),
    })
    .describe('Enables or disables an MCP server.'),
)


export const SDKControlStopTaskRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('stop_task'),
      task_id: z.string(),
    })
    .describe('Stops a running task.'),
)

export const SDKControlApplyFlagSettingsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('apply_flag_settings'),
      settings: z.record(z.string(), z.unknown()),
    })
    .describe(
      'Merges the provided settings into the flag settings layer, updating the active configuration.',
    ),
)

export const SDKControlGetSettingsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_settings'),
    })
    .describe(
      'Returns the effective merged settings and the raw per-source settings.',
    ),
)

export const SDKControlGetSettingsResponseSchema = lazySchema(() =>
  z
    .object({
      effective: z.record(z.string(), z.unknown()),
      sources: z
        .array(
          z.object({
            source: z.enum([
              'userSettings',
              'projectSettings',
              'localSettings',
              'flagSettings',
              'policySettings',
            ]),
            settings: z.record(z.string(), z.unknown()),
          }),
        )
        .describe(
          'Ordered low-to-high priority — later entries override earlier ones.',
        ),
      applied: z
        .object({
          model: z.string(),
          // String levels only — numeric effort is ant-only and the
          // Zod→proto generator can't emit enum∪number unions.
          effort: z.enum(['low', 'medium', 'high', 'max']).nullable(),
        })
        .optional()
        .describe(
          'Runtime-resolved values after env overrides, session state, and model-specific defaults are applied. Unlike `effective` (disk merge), these reflect what will actually be sent to the API.',
        ),
    })
    .describe(
      'Effective merged settings plus raw per-source settings in merge order.',
    ),
)

export const SDKControlElicitationRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('elicitation'),
      mcp_server_name: z.string(),
      message: z.string(),
      mode: z.enum(['form', 'url']).optional(),
      url: z.string().optional(),
      elicitation_id: z.string().optional(),
      requested_schema: z.record(z.string(), z.unknown()).optional(),
    })
    .describe(
      'Requests the SDK consumer to handle an MCP elicitation (user input request).',
    ),
)

export const SDKControlElicitationResponseSchema = lazySchema(() =>
  z
    .object({
      action: z.enum(['accept', 'decline', 'cancel']),
      content: z.record(z.string(), z.unknown()).optional(),
    })
    .describe('Response from the SDK consumer for an elicitation request.'),
)

export const SDKControlSessionStartRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('session_start'),
      prompt: z.string(),
      title: z.string(),
      context: z.enum(['fresh', 'fork']),
      worktree: z.boolean(),
      card: z.number().int().positive().optional(),
      role: z.enum(KANBAN_ROLES).optional(),
    })
    .describe('Asks the host to start a new session that begins with the given prompt, as the owner or reviewer of a board card when one is given.'),
)

export const SDKControlSessionStartResponseSchema = lazySchema(() =>
  z
    .object({
      sessionId: z.string(),
      title: z.string(),
    })
    .describe('Response from the host for a session_start request.'),
)

export const SDKControlSessionSendRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('session_send'),
      to: z.string(),
      message: z.string(),
      summary: z.string(),
      mode: z.enum(['message', 'report']).optional(),
    })
    .describe('Asks the host to deliver a message to another session by session id.'),
)

export const SDKControlSessionSendResponseSchema = lazySchema(() =>
  z
    .object({
      delivered: z.boolean(),
      error: z.string().optional(),
    })
    .describe('Response from the host for a session_send request.'),
)

export const SDKControlSessionListRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('session_list'),
      project: z.string().optional(),
    })
    .describe('Asks the host for the sessions this session can message.'),
)

export const SDKControlSessionRenameRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('session_rename'),
      title: z.string(),
    })
    .describe('Asks the host to change the title of the calling session.'),
)

export const SDKControlSessionRenameResponseSchema = lazySchema(() =>
  z
    .object({
      title: z.string(),
    })
    .describe('Response from the host for a session_rename request.'),
)

export const SDKSessionListEntrySchema = lazySchema(() =>
  z.object({
    sessionId: z.string(),
    title: z.string(),
    project: z.string(),
    parentSessionId: z.string().optional(),
    relation: z.enum(['parent', 'child', 'self', 'none']),
    running: z.boolean(),
  }),
)

export const SDKControlSessionListResponseSchema = lazySchema(() =>
  z
    .object({
      sessions: z.array(SDKSessionListEntrySchema()),
    })
    .describe('Response from the host for a session_list request.'),
)

export type SDKControlSessionStartRequest = z.infer<
  ReturnType<typeof SDKControlSessionStartRequestSchema>
>
export type SDKControlSessionStartResponse = z.infer<
  ReturnType<typeof SDKControlSessionStartResponseSchema>
>
export type SDKControlSessionSendRequest = z.infer<
  ReturnType<typeof SDKControlSessionSendRequestSchema>
>
export type SDKControlSessionSendResponse = z.infer<
  ReturnType<typeof SDKControlSessionSendResponseSchema>
>
export type SDKControlSessionRenameRequest = z.infer<
  ReturnType<typeof SDKControlSessionRenameRequestSchema>
>
export type SDKControlSessionRenameResponse = z.infer<
  ReturnType<typeof SDKControlSessionRenameResponseSchema>
>
export type SDKControlSessionListRequest = z.infer<
  ReturnType<typeof SDKControlSessionListRequestSchema>
>
export type SDKControlSessionListResponse = z.infer<
  ReturnType<typeof SDKControlSessionListResponseSchema>
>
export type SDKSessionListEntry = z.infer<
  ReturnType<typeof SDKSessionListEntrySchema>
>


// ============================================================================
// Control Request/Response Wrappers
// ============================================================================

export const KANBAN_CARD_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
] as const
export const KANBAN_PRIORITIES = ['high', 'normal', 'low'] as const
export const KANBAN_ROLES = ['owner', 'reviewer'] as const
export const KANBAN_UPDATE_KINDS = ['progress', 'comment', 'decision'] as const
const KANBAN_NOTIFY_EXTRA = ['creator'] as const
const KANBAN_CREATE_APPROVALS = ['task', 'board'] as const
export const KANBAN_LIST_SCOPES = ['mine', 'all'] as const

const kanbanCard = () => z.number().int().positive()
const kanbanText = () => z.string().trim().min(1)
export const KANBAN_NOTE_LIMIT = 2000
const NOTE_TOO_LONG = `Keep it under ${KANBAN_NOTE_LIMIT} characters. Write longer content, such as a review report, to a file and put its path in links.`
const kanbanNote = () => kanbanText().max(KANBAN_NOTE_LIMIT, NOTE_TOO_LONG)
const kanbanOptionalNote = () => z.string().max(KANBAN_NOTE_LIMIT, NOTE_TOO_LONG).optional()
const kanbanLinks = () => z.array(kanbanText()).optional()

const KanbanAssignmentTargetSchema = lazySchema(() =>
  z.union([
    z.object({ sessionId: z.string().min(1) }).strict(),
    z.object({ newSession: z.literal(true) }).strict(),
  ]),
)

const KanbanRepositoryOptionsSchema = lazySchema(() =>
  z
    .object({
      branch: z.string().nullable().optional(),
      worktree: z.boolean().optional(),
    })
    .strict(),
)

const kanbanCreateCard = () =>
  z.object({
    type: z.literal('create_card'),
    title: kanbanText(),
    description: z.string().optional(),
    acceptance: z.array(kanbanText()).optional(),
    parent: kanbanCard().optional(),
    priority: z.enum(KANBAN_PRIORITIES).optional(),
    status: z.enum(['backlog', 'todo']).optional(),
    dependsOn: z.array(kanbanCard()).optional(),
  })

const kanbanUpdateCommands = () => [
  z.object({
    type: z.literal('edit_card'),
    card: kanbanCard(),
    title: kanbanText().optional(),
    description: z.string().optional(),
    acceptance: z.array(kanbanText()).optional(),
    priority: z.enum(KANBAN_PRIORITIES).optional(),
  }),
  z.object({
    type: z.literal('move_card'),
    card: kanbanCard(),
    status: z.enum(['backlog', 'todo']),
    order: z.number().optional(),
  }),
  z.object({ type: z.literal('start'), card: kanbanCard() }),
  z.object({ type: z.literal('block'), card: kanbanCard(), reason: kanbanNote() }),
  z.object({ type: z.literal('unblock'), card: kanbanCard() }),
  z.object({
    type: z.literal('submit'),
    card: kanbanCard(),
    summary: kanbanNote(),
    links: kanbanLinks(),
  }),
  z.object({ type: z.literal('request_changes'), card: kanbanCard(), reason: kanbanNote(), links: kanbanLinks() }),
  z.object({ type: z.literal('accept'), card: kanbanCard(), summary: kanbanNote(), links: kanbanLinks() }),
  z.object({ type: z.literal('reset'), card: kanbanCard(), reason: kanbanOptionalNote() }),
  z.object({
    type: z.literal('cancel'),
    card: kanbanCard(),
    reason: kanbanOptionalNote(),
    cancelDependents: z.boolean().optional(),
    cancelChildren: z.boolean().optional(),
  }),
  z.object({ type: z.literal('add_dependency'), card: kanbanCard(), dependsOn: kanbanCard() }),
  z.object({ type: z.literal('remove_dependency'), card: kanbanCard(), dependsOn: kanbanCard() }),
  z.object({ type: z.literal('revoke_assignment'), assignment: z.string().min(1), reason: kanbanNote() }),
] as const

export const KanbanCommandSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    kanbanCreateCard(),
    ...kanbanUpdateCommands(),
    z.object({
      type: z.literal('add_update'),
      card: kanbanCard(),
      kind: z.enum(KANBAN_UPDATE_KINDS),
      text: kanbanNote(),
      notify: z.array(z.enum(KANBAN_NOTIFY_EXTRA)).optional(),
    }),
    z.object({ type: z.literal('reopen'), card: kanbanCard(), reason: kanbanOptionalNote() }),
    z.object({
      type: z.literal('assign'),
      card: kanbanCard(),
      role: z.enum(KANBAN_ROLES),
      target: KanbanAssignmentTargetSchema(),
      note: kanbanOptionalNote(),
      repository: KanbanRepositoryOptionsSchema().optional(),
    }),
    z.object({ type: z.literal('archive'), card: kanbanCard() }),
    z.object({ type: z.literal('unarchive'), card: kanbanCard() }),
    z.object({ type: z.literal('resend_notification'), notification: z.number().int().positive() }),
  ]),
)

export const KanbanCreateCardCommandSchema = lazySchema(kanbanCreateCard)

const kanbanSessionUpdateCommands = () => [
  ...kanbanUpdateCommands(),
  z.strictObject({
    type: z.literal('add_update'),
    card: kanbanCard(),
    kind: z.enum(KANBAN_UPDATE_KINDS),
    text: kanbanNote(),
  }),
  z.strictObject({
    type: z.literal('assign'),
    card: kanbanCard(),
    role: z.enum(KANBAN_ROLES),
    target: z.union([z.literal('self'), z.strictObject({ sessionId: z.string().min(1) })]),
    note: kanbanOptionalNote(),
  }),
] as const

export const KanbanAgentUpdateCommandSchema = lazySchema(() => z.discriminatedUnion('type', kanbanSessionUpdateCommands()))

const KanbanSessionCommandSchema = lazySchema(() => z.discriminatedUnion('type', [kanbanCreateCard(), ...kanbanSessionUpdateCommands()]))

export const SDKControlKanbanQueryRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('kanban_query'),
      list: z
        .object({
          scope: z.enum(KANBAN_LIST_SCOPES),
          status: z.array(z.enum(KANBAN_CARD_STATUSES)).optional(),
        })
        .optional(),
      card: kanbanCard().optional(),
      history: z.boolean().optional(),
      create: z.object({ parent: kanbanCard().optional() }).optional(),
    })
    .describe('Asks the host for cards on the project board of the calling session, or what creating a card needs the user to approve.'),
)

export const SDKControlKanbanQueryResponseSchema = lazySchema(() =>
  z
    .object({
      board: z.object({ project: z.string() }).optional(),
      cards: z.array(z.record(z.string(), z.unknown())).optional(),
      card: z.record(z.string(), z.unknown()).optional(),
      approval: z.enum(KANBAN_CREATE_APPROVALS).nullable().optional(),
    })
    .describe('Response from the host for a kanban_query request.'),
)

export const SDKControlKanbanCommandRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('kanban_command'),
      command: KanbanSessionCommandSchema(),
    })
    .describe('Asks the host to apply a command to the project board of the calling session.'),
)

export const SDKControlKanbanCommandResponseSchema = lazySchema(() =>
  z
    .object({
      card: z.record(z.string(), z.unknown()).optional(),
      warnings: z.array(z.string()),
    })
    .describe('Response from the host for a kanban_command request.'),
)

export type KanbanCommand = z.infer<ReturnType<typeof KanbanCommandSchema>>
export type KanbanRepositoryOptions = z.infer<ReturnType<typeof KanbanRepositoryOptionsSchema>>
export type KanbanSessionCommand = z.infer<ReturnType<typeof KanbanSessionCommandSchema>>
export type SDKControlKanbanQueryRequest = z.infer<ReturnType<typeof SDKControlKanbanQueryRequestSchema>>
export type SDKControlKanbanQueryResponse = z.infer<ReturnType<typeof SDKControlKanbanQueryResponseSchema>>
export type SDKControlKanbanCommandResponse = z.infer<ReturnType<typeof SDKControlKanbanCommandResponseSchema>>

export const SDKControlRequestInnerSchema = lazySchema(() =>
  z.union([
    SDKControlInterruptRequestSchema(),
    SDKControlPermissionRequestSchema(),
    SDKControlInitializeRequestSchema(),
    SDKControlSetPermissionModeRequestSchema(),
    SDKControlSetModelRequestSchema(),
    SDKControlSetMaxThinkingTokensRequestSchema(),
    SDKControlMcpStatusRequestSchema(),
    SDKControlGetContextUsageRequestSchema(),
    SDKControlGetSessionUsageRequestSchema(),
    SDKHookCallbackRequestSchema(),
    SDKControlMcpMessageRequestSchema(),
    SDKControlRewindFilesRequestSchema(),
    SDKControlCancelAsyncMessageRequestSchema(),
    SDKControlSeedReadStateRequestSchema(),
    SDKControlMcpSetServersRequestSchema(),
    SDKControlReloadPluginsRequestSchema(),
    SDKControlMcpReconnectRequestSchema(),
    SDKControlMcpToggleRequestSchema(),
    SDKControlStopTaskRequestSchema(),
    SDKControlApplyFlagSettingsRequestSchema(),
    SDKControlGetSettingsRequestSchema(),
    SDKControlElicitationRequestSchema(),
    SDKControlSessionStartRequestSchema(),
    SDKControlSessionSendRequestSchema(),
    SDKControlSessionListRequestSchema(),
    SDKControlSessionRenameRequestSchema(),
    SDKControlKanbanQueryRequestSchema(),
    SDKControlKanbanCommandRequestSchema(),
  ]),
)

export const SDKControlRequestSchema = lazySchema(() =>
  z.object({
    type: z.literal('control_request'),
    request_id: z.string(),
    request: SDKControlRequestInnerSchema(),
  }),
)

export const ControlResponseSchema = lazySchema(() =>
  z.object({
    subtype: z.literal('success'),
    request_id: z.string(),
    response: z.record(z.string(), z.unknown()).optional(),
  }),
)

export const ControlErrorResponseSchema = lazySchema(() =>
  z.object({
    subtype: z.literal('error'),
    request_id: z.string(),
    error: z.string(),
    pending_permission_requests: z
      .array(z.lazy(() => SDKControlRequestSchema()))
      .optional(),
  }),
)

export const SDKControlResponseSchema = lazySchema(() =>
  z.object({
    type: z.literal('control_response'),
    response: z.union([ControlResponseSchema(), ControlErrorResponseSchema()]),
  }),
)

export const SDKControlCancelRequestSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('control_cancel_request'),
      request_id: z.string(),
    })
    .describe('Cancels a currently open control request.'),
)

export const SDKKeepAliveMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('keep_alive'),
    })
    .describe('Keep-alive message to maintain WebSocket connection.'),
)

export const SDKUpdateEnvironmentVariablesMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('update_environment_variables'),
      variables: z.record(z.string(), z.string()),
    })
    .describe('Updates environment variables at runtime.'),
)

// ============================================================================
// Aggregate Message Types
// ============================================================================

export const StdoutMessageSchema = lazySchema(() =>
  z.union([
    SDKMessageSchema(),
    SDKStreamlinedTextMessageSchema(),
    SDKStreamlinedToolUseSummaryMessageSchema(),
    SDKPostTurnSummaryMessageSchema(),
    SDKControlResponseSchema(),
    SDKControlRequestSchema(),
    SDKControlCancelRequestSchema(),
    SDKKeepAliveMessageSchema(),
  ]),
)

export const StdinMessageSchema = lazySchema(() =>
  z.union([
    SDKUserMessageSchema(),
    SDKControlRequestSchema(),
    SDKControlResponseSchema(),
    SDKKeepAliveMessageSchema(),
    SDKUpdateEnvironmentVariablesMessageSchema(),
  ]),
)
