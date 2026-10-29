import { windowsById, type ContextWindowSource } from './source.js'

const LISTED_FIELDS = ['max_input_tokens', 'context_length', 'context_window'] as const

export const listedSource: ContextWindowSource = {
  id: 'listed',
  matches: () => true,
  windows: async ({ listed }) => windowsById(listed, 'id', (entry) => (
    LISTED_FIELDS.map((field) => entry[field]).find((value) => typeof value === 'number')
  )),
}
