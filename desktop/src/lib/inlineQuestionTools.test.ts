import { describe, expect, it } from 'vitest'
import { isInlineQuestionTool } from './inlineQuestionTools'

describe('isInlineQuestionTool', () => {
  it('covers the tools that ask the user inline', () => {
    expect(isInlineQuestionTool('AskUserQuestion')).toBe(true)
    expect(isInlineQuestionTool('ChooseDesignTemplate')).toBe(true)
  })

  it('leaves other tools and missing names out', () => {
    expect(isInlineQuestionTool('Bash')).toBe(false)
    expect(isInlineQuestionTool('ShowUI')).toBe(false)
    expect(isInlineQuestionTool(undefined)).toBe(false)
  })
})
