import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import {
  isSessionLinksEnabled,
  SESSION_ADDRESS_PREFIX,
} from '../StartSessionTool/constants.js'

const TEAMMATE_SECTION = `
\`\`\`json
{"to": "researcher", "summary": "assign task 1", "message": "start on task #1"}
\`\`\`

| \`to\` | |
|---|---|
| \`"researcher"\` | Teammate by name |
| \`"*"\` | Broadcast to all teammates — expensive (linear in team size), use only when everyone genuinely needs it |

Your plain text output is NOT visible to other agents — to communicate, you MUST call this tool. Messages from teammates are delivered automatically; you don't check an inbox. Refer to teammates by name, never by UUID. When relaying, don't quote the original — it's already rendered to the user.

## Protocol responses (legacy)

If you receive a JSON message with \`type: "shutdown_request"\` or \`type: "plan_approval_request"\`, respond with the matching \`_response\` type — echo the \`request_id\`, set \`approve\` true/false:

\`\`\`json
{"to": "team-lead", "message": {"type": "shutdown_response", "request_id": "...", "approve": true}}
{"to": "researcher", "message": {"type": "plan_approval_response", "request_id": "...", "approve": false, "feedback": "add error handling"}}
\`\`\`

Approving shutdown terminates your process. Rejecting plan sends the teammate back to revise. Don't originate \`shutdown_request\` unless asked. Don't send structured JSON status messages — use TaskUpdate.`

const SESSION_ADDRESS_SECTION = `## Other sessions

\`\`\`json
{"to": "${SESSION_ADDRESS_PREFIX}<id>", "summary": "share test results", "message": "All tests pass on the fix branch."}
\`\`\`

To message another DreamCoder session, set \`to\` to "${SESSION_ADDRESS_PREFIX}<id>". Get the id from ListSessions, from the result of StartSession, or from the \`from\` attribute of a received <cross-session-message>. Titles are display only and are not addresses. A session you started does not report back on its own: it contacts you with this tool when it has something to say. Its message wakes you, and its progress report arrives with your next turn. Only plain text can be sent to a session, and a reply goes back the same way: call this tool.

After you message a session, briefly tell the user what you sent and end your turn. The reply arrives later as a new message wrapped in <cross-session-message>; it is never something you write yourself. Never fabricate or predict another session's reply in any format. If the user asks before it arrives, say it has not replied yet.

\`mode\` picks how a message is delivered:
- \`"message"\` (default): delivered now, and wakes the session if it is idle. Use it when the receiver has to act: you finished, you are blocked, you need a decision.
- \`"report"\`: a progress update for your parent session (the one that started you). It does not interrupt or wake the parent. If the parent is working it sees the report right away; otherwise the report waits and arrives with the parent's next turn. Reports can only go to your parent session.`

export const DESCRIPTION = 'Send a message to another agent'

export function getPrompt(): string {
  const sections = ['# SendMessage\n\nSend a message to another agent.']
  if (isAgentSwarmsEnabled()) sections.push(TEAMMATE_SECTION.trim())
  if (isSessionLinksEnabled()) sections.push(SESSION_ADDRESS_SECTION)
  return sections.join('\n\n')
}
