import { START_SESSION_TOOL_NAME } from './constants.js'
import { SEND_MESSAGE_TOOL_NAME } from '../SendMessageTool/constants.js'

export const DESCRIPTION = 'Start a new, separate session that works on a task on its own.'

export const PROMPT = `Start a new session that runs independently of this one. Use it for separate, longer work that should continue on its own while you and the user carry on, for example a second task in the same project, a side investigation, or work that needs its own context.

The new session starts immediately with the prompt you give it, as if the user had typed it, and it does not see this conversation unless you ask for context "fork". Write the prompt as a complete brief: the goal, the relevant files or facts, and what you expect back.

- title: a short title shown in the session list.
- context: "fresh" starts with an empty conversation. "fork" starts with a copy of this conversation so far.
- worktree: true runs the new session in a new git worktree of this session's repository, so its file changes do not collide with yours. Defaults to false.

The user must approve every session you start, whatever the permission mode. Ask only when the work is worth a session of its own.

The new session decides on its own when to contact you, so tell it in the prompt what you expect back and when. You do not need to poll. After starting it, briefly tell the user what you started and end your turn. Never fabricate or predict the new session's results in any format; they arrive later as messages. See ${SEND_MESSAGE_TOOL_NAME} for talking to it.`

export const START_SESSION_PERMISSION_REASON = `${START_SESSION_TOOL_NAME} starts a new session that runs on its own and always needs your approval`
