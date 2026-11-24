import type { createBaseHookInput } from '../utils/hooks.js'

export type FileSuggestionCommandInput = ReturnType<
  typeof createBaseHookInput
> & {
  query: string
}
