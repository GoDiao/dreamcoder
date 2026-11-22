import type {
  BetaMessage,
  BetaRawMessageStreamEvent,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { z } from 'zod/v4'

export type NonNullableUsage = {
  [K in keyof BetaUsage]: NonNullable<BetaUsage[K]>
}

type PlaceholderFields = {
  user: { message: MessageParam }
  assistant: { message: BetaMessage }
  stream_event: { event: BetaRawMessageStreamEvent }
  result: { usage: NonNullableUsage }
}

type ResolveFields<T> = T extends {
  type: infer K extends keyof PlaceholderFields
}
  ? Omit<T, keyof PlaceholderFields[K]> & PlaceholderFields[K]
  : T

type UuidPlaceholderKey = 'uuid' | 'head_uuid' | 'anchor_uuid' | 'tail_uuid'

type ResolveUuid<T> = T extends readonly (infer Item)[]
  ? ResolveUuid<Item>[]
  : T extends object
    ? { [K in keyof T]: K extends UuidPlaceholderKey ? UUID : ResolveUuid<T[K]> }
    : T

export type InferSdkSchema<S extends () => z.ZodType> = ResolveFields<
  ResolveUuid<z.infer<ReturnType<S>>>
>
