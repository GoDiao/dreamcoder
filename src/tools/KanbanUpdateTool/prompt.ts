import { KANBAN_NOTE_LIMIT } from '../../entrypoints/sdk/controlSchemas.js'
import { SEND_MESSAGE_TOOL_NAME } from '../SendMessageTool/constants.js'
import { START_SESSION_TOOL_NAME } from '../StartSessionTool/constants.js'
import { KANBAN_UPDATE_TOOL_NAME } from '../KanbanListTool/constants.js'

export const DESCRIPTION = 'Record progress, blockers and results on a project board card, or manage the cards you created.'

export const PROMPT = `Apply one command to a card on the project board. Set command.type and its fields.

A card has an owner (the session that does it), a reviewer when one is assigned (it checks the result and accepts it; without one the person accepts), and a creator (the person or session that created it). What you may do depends on which of these you are.

As the owner:
- start: Backlog or Todo to In Progress. Needs your assignment to be active and every card it depends on to be Done.
- submit: In Progress to Review, with a report of the result in summary: what was done, how it was verified, what is left open. The work itself (code, branches, files) stays where it is; add links to the branch, commits or PR as references when there are any. It tells the reviewer and the creator. Submitting never makes the card Done.
- When you find the card is no longer needed, do not stop silently: block it with the reason. Its creator decides whether to cancel it.
- When the card needs a reviewer, ask its creator. The owner does not choose the reviewer.

As the owner or the creator:
- block (with reason) and unblock. Blocking tells the creator; unblocking tells the owner.
- edit_card: title, description and priority, to refine the card as you learn more.
- add_dependency and remove_dependency.
- assign: make an existing session (target.sessionId) the card's "owner". Whoever holds that role now is replaced and told so. To hand the card to a new session, start it with ${START_SESSION_TOOL_NAME} and pass the card and role instead.

The acceptance criteria belong to the creator, who changes them with edit_card. As the owner, do not change them on your own. When one is unclear, wrong or cannot be met, ask the creator: with ${SEND_MESSAGE_TOOL_NAME} when the creator is a session; when the creator is the person, block the card with your question, which puts it in the person's "needs me" list, and the person may come to this session to settle it with you. Only when the person agrees with you in this session on new criteria, write them with edit_card; the user approves that change every time. Meanwhile do the parts that do not depend on the answer.

As the reviewer, once the owner submits, check the result as your review instructions say, against each acceptance criterion. Then:
- accept (with a report in summary: what you checked and how, and links to your review report): Review to Done. It tells the owner and the creator.
- request_changes (with reason, and links to your review report): Review back to In Progress. It tells the owner.

As the creator:
- When the owner questions an acceptance criterion, decide whether to change it. Change it with edit_card and tell the owner, or tell the owner why it stays. When the user should decide, ask the user in this session first.
- Choose the reviewer: assign with role "reviewer", or start a new session in that role with ${START_SESSION_TOOL_NAME}. Whoever reviews now is replaced and told so. Put its review instructions in note: what to check and by which standard, for example reviewing the code or helping the user try the result; without a note it gets general instructions. When you also own the card, the user approves every reviewer you choose.
- move_card (between Backlog and Todo), reset (back to Todo) and revoke_assignment. Reset tells the owner.
- cancel, when the card is no longer needed. The user approves every cancel. It tells the owner, and the result lists the open cards that depend on it and its unfinished sub-cards: remove those dependencies or cancel those cards too, so nothing is left waiting on it.

Any session may add_update: record progress, a comment or a decision (kind "progress", "comment" or "decision"). It is saved on the card and notifies nobody.

Any session may assign itself (target "self") as the owner or reviewer of any card, for example when the user asks you to take a card over. A session cannot both own and review the same card.

Making yourself a reviewer, and choosing the reviewer of a card you also own, needs the user's approval every time. Otherwise assigning a session you started needs no approval, and any other assign asks the user to approve it, unless the permission mode lets it through.

Texts on the board (updates, summaries, reasons) are shown to the person as Markdown: organize a longer result with headings and lists. They stay under ${KANBAN_NOTE_LIMIT} characters. Write anything longer, such as a review report, to a file in the project and put its path in links; the person opens it from the card and other sessions read it from there.

The board refuses what your role does not allow and says why. To reach another session right away, use ${SEND_MESSAGE_TOOL_NAME}; the board itself notifies only on assignments, comments from the person, submissions, blockers, requested changes, unblocking, resets and cancellations.`

export const KANBAN_CANCEL_PERMISSION_REASON = `${KANBAN_UPDATE_TOOL_NAME} cancels a card of the project board and always needs your approval`
export const KANBAN_ACCEPTANCE_PERMISSION_REASON = `${KANBAN_UPDATE_TOOL_NAME} changes the acceptance criteria of a card this session did not create, which needs your approval every time`
export const KANBAN_ASSIGN_PERMISSION_REASON = `${KANBAN_UPDATE_TOOL_NAME} changes who works on a card of the project board`
export const KANBAN_REVIEWER_PERMISSION_REASON = `${KANBAN_UPDATE_TOOL_NAME} makes this session a reviewer, or chooses the reviewer of a card this session also owns, which needs your approval every time`
