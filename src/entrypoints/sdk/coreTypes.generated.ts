import type * as schemas from './coreSchemas.js'
import type { InferSdkSchema } from './sdkUtilityTypes.js'

export type ApiKeySource = InferSdkSchema<typeof schemas.ApiKeySourceSchema>
export type AsyncHookJSONOutput = InferSdkSchema<
  typeof schemas.AsyncHookJSONOutputSchema
>
export type ConfigChangeHookInput = InferSdkSchema<
  typeof schemas.ConfigChangeHookInputSchema
>
export type CwdChangedHookInput = InferSdkSchema<
  typeof schemas.CwdChangedHookInputSchema
>
export type ElicitationHookInput = InferSdkSchema<
  typeof schemas.ElicitationHookInputSchema
>
export type ElicitationResultHookInput = InferSdkSchema<
  typeof schemas.ElicitationResultHookInputSchema
>
export type ExitReason = InferSdkSchema<typeof schemas.ExitReasonSchema>
export type FileChangedHookInput = InferSdkSchema<
  typeof schemas.FileChangedHookInputSchema
>
export type HookEvent = InferSdkSchema<typeof schemas.HookEventSchema>
export type HookInput = InferSdkSchema<typeof schemas.HookInputSchema>
export type HookJSONOutput = InferSdkSchema<typeof schemas.HookJSONOutputSchema>
export type InstructionsLoadedHookInput = InferSdkSchema<
  typeof schemas.InstructionsLoadedHookInputSchema
>
export type McpServerConfigForProcessTransport = InferSdkSchema<
  typeof schemas.McpServerConfigForProcessTransportSchema
>
export type McpServerStatus = InferSdkSchema<
  typeof schemas.McpServerStatusSchema
>
export type ModelInfo = InferSdkSchema<typeof schemas.ModelInfoSchema>
export type ModelUsage = InferSdkSchema<typeof schemas.ModelUsageSchema>
export type NotificationHookInput = InferSdkSchema<
  typeof schemas.NotificationHookInputSchema
>
export type PermissionDeniedHookInput = InferSdkSchema<
  typeof schemas.PermissionDeniedHookInputSchema
>
export type PermissionMode = InferSdkSchema<typeof schemas.PermissionModeSchema>
export type PermissionRequestHookInput = InferSdkSchema<
  typeof schemas.PermissionRequestHookInputSchema
>
export type PermissionResult = InferSdkSchema<
  typeof schemas.PermissionResultSchema
>
export type PermissionUpdate = InferSdkSchema<
  typeof schemas.PermissionUpdateSchema
>
export type PostCompactHookInput = InferSdkSchema<
  typeof schemas.PostCompactHookInputSchema
>
export type PostToolUseFailureHookInput = InferSdkSchema<
  typeof schemas.PostToolUseFailureHookInputSchema
>
export type PostToolUseHookInput = InferSdkSchema<
  typeof schemas.PostToolUseHookInputSchema
>
export type PreCompactHookInput = InferSdkSchema<
  typeof schemas.PreCompactHookInputSchema
>
export type PreToolUseHookInput = InferSdkSchema<
  typeof schemas.PreToolUseHookInputSchema
>
export type RewindFilesResult = InferSdkSchema<
  typeof schemas.RewindFilesResultSchema
>
export type SDKAssistantMessage = InferSdkSchema<
  typeof schemas.SDKAssistantMessageSchema
>
export type SDKAssistantMessageError = InferSdkSchema<
  typeof schemas.SDKAssistantMessageErrorSchema
>
export type SDKCompactBoundaryMessage = InferSdkSchema<
  typeof schemas.SDKCompactBoundaryMessageSchema
>
export type SDKMessage = InferSdkSchema<typeof schemas.SDKMessageSchema>
export type SDKPartialAssistantMessage = InferSdkSchema<
  typeof schemas.SDKPartialAssistantMessageSchema
>
export type SDKPermissionDenial = InferSdkSchema<
  typeof schemas.SDKPermissionDenialSchema
>
export type SDKRateLimitInfo = InferSdkSchema<
  typeof schemas.SDKRateLimitInfoSchema
>
export type SDKResultMessage = InferSdkSchema<
  typeof schemas.SDKResultMessageSchema
>
export type SDKResultSuccess = InferSdkSchema<
  typeof schemas.SDKResultSuccessSchema
>
export type SDKSessionInfo = InferSdkSchema<typeof schemas.SDKSessionInfoSchema>
export type SDKStatus = InferSdkSchema<typeof schemas.SDKStatusSchema>
export type SDKStatusMessage = InferSdkSchema<
  typeof schemas.SDKStatusMessageSchema
>
export type SDKSystemMessage = InferSdkSchema<
  typeof schemas.SDKSystemMessageSchema
>
export type SDKToolProgressMessage = InferSdkSchema<
  typeof schemas.SDKToolProgressMessageSchema
>
export type SDKUserMessage = InferSdkSchema<typeof schemas.SDKUserMessageSchema>
export type SDKUserMessageReplay = InferSdkSchema<
  typeof schemas.SDKUserMessageReplaySchema
>
export type SessionEndHookInput = InferSdkSchema<
  typeof schemas.SessionEndHookInputSchema
>
export type SessionStartHookInput = InferSdkSchema<
  typeof schemas.SessionStartHookInputSchema
>
export type SetupHookInput = InferSdkSchema<typeof schemas.SetupHookInputSchema>
export type StopFailureHookInput = InferSdkSchema<
  typeof schemas.StopFailureHookInputSchema
>
export type StopHookInput = InferSdkSchema<typeof schemas.StopHookInputSchema>
export type SubagentStartHookInput = InferSdkSchema<
  typeof schemas.SubagentStartHookInputSchema
>
export type SubagentStopHookInput = InferSdkSchema<
  typeof schemas.SubagentStopHookInputSchema
>
export type SyncHookJSONOutput = InferSdkSchema<
  typeof schemas.SyncHookJSONOutputSchema
>
export type TaskCompletedHookInput = InferSdkSchema<
  typeof schemas.TaskCompletedHookInputSchema
>
export type TaskCreatedHookInput = InferSdkSchema<
  typeof schemas.TaskCreatedHookInputSchema
>
export type TeammateIdleHookInput = InferSdkSchema<
  typeof schemas.TeammateIdleHookInputSchema
>
export type UserPromptSubmitHookInput = InferSdkSchema<
  typeof schemas.UserPromptSubmitHookInputSchema
>
