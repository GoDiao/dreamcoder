import { KANBAN_UPDATE_TOOL_NAME } from '../KanbanListTool/constants.js'

export const DESCRIPTION = 'Read one card on the project board in full.'

export const PROMPT = `Read one card on the project board: its description, acceptance criteria, parent, sub-cards, dependencies and the ones it still waits on, owner, reviewer (who accepts it; without one the person does), creator, your roles on it, its assignments with their instructions (a reviewer's review instructions), its latest updates and its latest delivered result. Set history to get every update and delivery; the result says how many earlier ones it left out. Linked files hold the long content, such as review reports; read them when you need the detail.

Read your card before you start work on it, and again when the board tells you about it. Record progress and results with ${KANBAN_UPDATE_TOOL_NAME}.`
