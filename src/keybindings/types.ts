import type { z } from 'zod/v4'
import type {
  KEYBINDING_ACTIONS,
  KEYBINDING_CONTEXTS,
  KeybindingBlockSchema,
} from './schema.js'

export type KeybindingContextName =
  | (typeof KEYBINDING_CONTEXTS)[number]
  | 'Scroll'
  | 'MessageActions'

export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number]

export type KeybindingBlock = Omit<
  z.infer<ReturnType<typeof KeybindingBlockSchema>>,
  'context'
> & {
  context: KeybindingContextName
}

export type ParsedKeystroke = {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  super: boolean
}

export type Chord = ParsedKeystroke[]

export type ParsedBinding = {
  chord: Chord
  action: KeybindingBlock['bindings'][string]
  context: KeybindingContextName
}
