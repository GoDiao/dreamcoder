// The text every candidate sees for a record. All candidates get the same
// string for the same view and budget, so differences come from the model,
// not from how much it was shown. Adapters must not shorten it further; a
// local model that cannot fit it reports that as truncation.
import type { Step, ToolCallRecord } from '../dataset/lib'

/**
 * How much of the history is shown.
 * - command: the user's request and the call only.
 * - recent1 / recent2: plus the last one or two steps, with their outputs.
 * - calls: plus every earlier call without outputs, like the CLI's
 *   transcript classifier, which leaves tool outputs out.
 * - full: plus every earlier step with its output.
 */
export const VIEWS = ['command', 'recent1', 'recent2', 'calls', 'full'] as const
export type View = (typeof VIEWS)[number]

const STEP_LIMIT: Record<View, number> = {
  command: 0,
  recent1: 1,
  recent2: 2,
  calls: Infinity,
  full: Infinity,
}

/**
 * With a budget, each part is capped so the call itself and the request are
 * always shown and history fills the rest: request ≤ 25% of the budget, call
 * ≤ 40%, and each step's input and output ≤ 300 characters. Budgets are in
 * characters so they mean the same for every tokenizer. 1,500 characters is
 * about 490 of Laya's tokens, more than the ~360 its window leaves after the
 * question, so Laya's adapter cuts most of these (and counts the cuts).
 */
const SHARE = { request: 0.25, call: 0.4 }
const STEP_PART = 300

/** Keep the head and tail of a long text. */
export function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const marker = ` [... ${text.length - max} chars cut ...] `
  const keep = Math.max(0, max - marker.length)
  const head = Math.ceil(keep * 0.7)
  return text.slice(0, head) + marker + text.slice(text.length - (keep - head))
}

const callText = (tool: string, input: unknown) => `${tool} ${JSON.stringify(input)}`

function stepText(index: number, step: Step, withOutput: boolean, part: number): string {
  const call = `#${index + 1} ${clipMiddle(callText(step.tool, step.input), part)}`
  return withOutput ? `${call}\noutput: ${clipMiddle(step.output, part)}` : call
}

/**
 * Cutting can split an emoji's surrogate pair, and a lone surrogate makes
 * the request invalid JSON for some providers. Lone surrogates become U+FFFD.
 */
export function renderState(record: ToolCallRecord, view: View, budget: number | null): string {
  return render(record, view, budget).toWellFormed()
}

function render(record: ToolCallRecord, view: View, budget: number | null): string {
  const limit = budget ?? Infinity
  const request = clipMiddle(record.context.user_request, Math.floor(limit * SHARE.request))
  const call = clipMiddle(callText(record.tool, record.input), Math.floor(limit * SHARE.call))
  const head = `User request:\n${request}\n\n`
  const tail = `Tool call to decide on:\n${call}\nWorking directory: ${record.cwd}`

  const steps = record.context.steps ?? []
  const withOutput = view !== 'calls'
  const part = budget === null ? Infinity : STEP_PART
  const shown: string[] = []
  let room = limit - head.length - tail.length - 60
  for (let i = steps.length - 1; i >= 0 && shown.length < STEP_LIMIT[view]; i--) {
    const text = stepText(i, steps[i]!, withOutput, part)
    if (text.length + 2 > room) break
    shown.unshift(text)
    room -= text.length + 2
  }
  if (shown.length === 0) return head + tail
  const label =
    shown.length === steps.length
      ? `Earlier steps (all ${steps.length}):`
      : `Earlier steps (last ${shown.length} of ${steps.length}):`
  return `${head}${label}\n${shown.join('\n\n')}\n\n${tail}`
}
