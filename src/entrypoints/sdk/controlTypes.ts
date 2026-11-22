import type * as schemas from './controlSchemas.js'
import type { InferSdkSchema } from './sdkUtilityTypes.js'

export type { SDKPartialAssistantMessage } from './coreTypes.generated.js'

export type SDKControlCancelRequest = InferSdkSchema<
  typeof schemas.SDKControlCancelRequestSchema
>
export type SDKControlInitializeRequest = InferSdkSchema<
  typeof schemas.SDKControlInitializeRequestSchema
>
export type SDKControlInitializeResponse = InferSdkSchema<
  typeof schemas.SDKControlInitializeResponseSchema
>
export type SDKControlMcpSetServersResponse = InferSdkSchema<
  typeof schemas.SDKControlMcpSetServersResponseSchema
>
export type SDKControlPermissionRequest = InferSdkSchema<
  typeof schemas.SDKControlPermissionRequestSchema
>
export type SDKControlReloadPluginsResponse = InferSdkSchema<
  typeof schemas.SDKControlReloadPluginsResponseSchema
>
export type SDKControlRequest = InferSdkSchema<
  typeof schemas.SDKControlRequestSchema
>
export type SDKControlRequestInner = InferSdkSchema<
  typeof schemas.SDKControlRequestInnerSchema
>
export type SDKControlResponse = InferSdkSchema<
  typeof schemas.SDKControlResponseSchema
>
export type StdinMessage = InferSdkSchema<typeof schemas.StdinMessageSchema>
export type StdoutMessage = InferSdkSchema<typeof schemas.StdoutMessageSchema>
