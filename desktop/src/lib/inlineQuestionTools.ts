export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion'
export const CHOOSE_DESIGN_TEMPLATE_TOOL = 'ChooseDesignTemplate'

const INLINE_QUESTION_TOOLS: readonly string[] = [ASK_USER_QUESTION_TOOL, CHOOSE_DESIGN_TEMPLATE_TOOL]

export function isInlineQuestionTool(toolName: string | undefined): boolean {
  return toolName !== undefined && INLINE_QUESTION_TOOLS.includes(toolName)
}
