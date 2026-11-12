import { START_SESSION_TOOL_NAME } from '../StartSessionTool/constants.js'
import { KANBAN_CREATE_TOOL_NAME, KANBAN_GET_TOOL_NAME, KANBAN_UPDATE_TOOL_NAME } from '../KanbanListTool/constants.js'

export const DESCRIPTION = 'Create a card on the project board.'

export const PROMPT = `Create a card on the project board. Cards form a tree: set parent to put the new card under another one, for example to split a card into sub-cards.

Under a card you own or created, the card is created right away. Anywhere else, including at the top of the board, it is a suggestion: the user is asked to approve it, unless the permission mode lets it through. When the project has no board yet, the first card also creates the board, and the user is always asked; do that only when the user asked for a board or for work to be tracked on it.

You become the card's creator: you may edit, move, cancel and reset it, and you are told when it is blocked or submitted. Write a clear goal in description and checkable acceptance criteria; use dependsOn for cards that must be done first.

Nobody works on the card until it has an owner. To hand it to a new session, start one with ${START_SESSION_TOOL_NAME} and pass the card: the new session is its owner from the start. To hand it to an existing session or take it yourself, use ${KANBAN_UPDATE_TOOL_NAME} (assign). Assign a reviewer too when someone should check the result, with instructions on what to check: the reviewer accepts the card, otherwise the person does. A new session can be the reviewer: start it with the card and role "reviewer". The result has the new card; read it again later with ${KANBAN_GET_TOOL_NAME}.`

export const KANBAN_CARD_PERMISSION_REASON = `${KANBAN_CREATE_TOOL_NAME} adds a card outside the cards this session owns or created`
export const KANBAN_BOARD_PERMISSION_REASON = `${KANBAN_CREATE_TOOL_NAME} creates the project board and always needs your approval`
