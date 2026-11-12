import { KANBAN_GET_TOOL_NAME } from './constants.js'

export const DESCRIPTION = "List the cards on this project's board."

export const PROMPT = `List the cards on the project board of this session's project. The board is shared by the person and the agent sessions working on the project; it records what to do, who owns it, how far it got and what came out. Cards form a tree: a card can be split into sub-cards.

scope "mine" (the default) lists the cards you own, review or created. "all" lists every card on the board.

Each row has the card id, title, status, priority, parent card, owner session, the cards it still waits on, and your roles on it. Pass status to keep only cards in those states. Read a card in full with ${KANBAN_GET_TOOL_NAME}.`
