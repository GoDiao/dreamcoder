import { act } from 'react'
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import type { SessionState, UIMessage } from '../../types/chat'

export const SCENARIO_SESSION_ID = 'render-count-session'

const T0 = 1_000_000

function mirror(turn: SessionState['turn']): SessionState {
  return {
    id: SCENARIO_SESSION_ID,
    version: 1,
    permission: { desired: 'default', effective: 'default' },
    runtime: { desired: null, effective: null },
    title: { text: null, source: null },
    workspace: { workDir: '/repo', projectRoot: '/repo', workDirExists: true },
    process: { phase: 'running', generation: 1 },
    turn,
    pendingPermissions: [],
    slashCommands: [],
    activeGoal: null,
    backgroundTasks: [],
    uiPages: [],
    team: null,
    clientCount: 1,
  }
}

const IDLE_TURN = { phase: 'idle' } as SessionState['turn']
const RUNNING_TURN = { phase: 'running', activity: 'thinking', startedAt: T0 } as SessionState['turn']

export const HISTORY_GROUP_ID = 'history-tool'
export const LIVE_GROUP_ID = 'live-tool'

const historyMessages: UIMessage[] = [
  { id: 'u1', type: 'user_text', content: 'Read the readme', timestamp: T0 - 100 },
  { id: 'a1', type: 'assistant_text', content: 'Reading it.', timestamp: T0 - 90 },
  { id: HISTORY_GROUP_ID, type: 'tool_use', toolName: 'Read', toolUseId: 'tu-history', input: { file_path: '/repo/README.md' }, timestamp: T0 - 80 },
  { id: 'r-history', type: 'tool_result', toolUseId: 'tu-history', content: 'readme body', isError: false, timestamp: T0 - 70 },
  { id: 'a2', type: 'assistant_text', content: 'Done.', timestamp: T0 - 60 },
]

export function scenarioInitialSession(): PerSessionState {
  return {
    messages: historyMessages,
    chatState: 'idle',
    connectionState: 'connected',
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    pendingPermission: null,
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    statusVerb: '',
    apiRetry: null,
    slashCommands: [{ name: 'help', description: 'Show help' }],
    agentTaskNotifications: {},
    backgroundAgentTasks: {},
    activeGoal: null,
    composerPrefill: null,
    composerInsertion: null,
    composerDraft: null,
    mirror: mirror(IDLE_TURN),
  }
}

export function installScenarioSession() {
  useChatStore.setState({ sessions: { [SCENARIO_SESSION_ID]: scenarioInitialSession() } })
  useTabStore.setState({
    activeTabId: SCENARIO_SESSION_ID,
    tabs: [{ sessionId: SCENARIO_SESSION_ID, title: 'Render counts', type: 'session', status: 'idle' }],
  })
}

function patch(update: (session: PerSessionState) => Partial<PerSessionState>) {
  act(() => {
    useChatStore.setState((state) => {
      const session = state.sessions[SCENARIO_SESSION_ID]!
      return { sessions: { ...state.sessions, [SCENARIO_SESSION_ID]: { ...session, ...update(session) } } }
    })
  })
}

function append(...messages: UIMessage[]) {
  return (session: PerSessionState) => ({ messages: [...session.messages, ...messages] })
}

export function playStreamingReply() {
  let tokens = 0
  const usage = () => {
    tokens += 25
    return { tokenUsage: { input_tokens: 1200, output_tokens: tokens } }
  }

  patch((s) => ({
    ...append({ id: 'u2', type: 'user_text', content: 'Run the tests', timestamp: T0 })(s),
    chatState: 'thinking',
    statusVerb: 'Thinking',
    mirror: mirror(RUNNING_TURN),
  }))
  patch(usage)
  for (let i = 0; i < 10; i++) {
    patch((s) => ({ chatState: 'streaming', streamingText: `${s.streamingText}chunk ${i} ` }))
  }
  for (let i = 0; i < 3; i++) patch(usage)
  patch((s) => ({
    ...append(
      { id: 'a3', type: 'assistant_text', content: s.streamingText, timestamp: T0 + 10 },
      { id: LIVE_GROUP_ID, type: 'tool_use', toolName: 'Bash', toolUseId: 'tu-live', input: { command: 'bun test' }, timestamp: T0 + 11 },
    )(s),
    streamingText: '',
    chatState: 'tool_executing',
    activeToolUseId: 'tu-live',
    activeToolName: 'Bash',
  }))
  patch(() => ({
    chatState: 'permission_pending',
    pendingPermission: { requestId: 'perm-1', toolName: 'Bash', toolUseId: 'tu-live', input: { command: 'bun test' } },
  }))
  patch(() => ({ chatState: 'tool_executing', pendingPermission: null }))
  patch((s) => ({
    ...append({ id: 'r-live', type: 'tool_result', toolUseId: 'tu-live', content: 'all passed', isError: false, timestamp: T0 + 20 })(s),
    activeToolUseId: null,
    activeToolName: null,
    chatState: 'thinking',
  }))
  patch(usage)
  for (let i = 0; i < 10; i++) {
    patch((s) => ({ chatState: 'streaming', streamingText: `${s.streamingText}more ${i} ` }))
  }
  patch((s) => ({
    ...append({ id: 'a4', type: 'assistant_text', content: s.streamingText, timestamp: T0 + 30 })(s),
    streamingText: '',
    chatState: 'idle',
    statusVerb: '',
    mirror: mirror(IDLE_TURN),
    ...usage(),
  }))
}

export const SCENARIO_UPDATE_COUNT = 31
