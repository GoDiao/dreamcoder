import { SEND_MESSAGE_TOOL_NAME } from '../SendMessageTool/constants.js'
import { SESSION_ADDRESS_PREFIX } from '../StartSessionTool/constants.js'

export const DESCRIPTION = 'List the other sessions in DreamCoder that you can message.'

export const PROMPT = `List the sessions that exist in DreamCoder, across all projects. Each row has the session id, the title, the project it works in, whether it is running, the parent session if it was started by another session, and its relation to you: "parent" (started you), "child" (you started it), "self" or "none".

Pass project to list only the sessions of one project. Message a session with ${SEND_MESSAGE_TOOL_NAME} using to "${SESSION_ADDRESS_PREFIX}<sessionId>". Names are display only and are not addresses.`
