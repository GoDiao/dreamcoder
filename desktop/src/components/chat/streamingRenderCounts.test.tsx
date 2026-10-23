import { Profiler, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

const counts = vi.hoisted(() => ({
  commits: {} as Record<string, number>,
  toolGroups: {} as Record<string, number>,
  toolGroupProps: {} as Record<string, { resultMap: Map<string, { content: unknown }> }>,
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: new Proxy({}, { get: () => () => new Promise(() => {}) }),
}))

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: vi.fn(),
  },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }),
}))

vi.mock('../controls/PermissionModeSelector', () => ({
  PermissionModeSelector: ({ value, effectiveValue }: { value: string; effectiveValue?: string }) => (
    <button type="button" data-testid="permission-mode" data-value={value} data-effective={effectiveValue ?? ''}>
      Permissions
    </button>
  ),
}))

vi.mock('../controls/ModelSelector', () => ({
  ModelSelector: () => <button type="button">Model</button>,
}))

vi.mock('./ToolCallGroup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ToolCallGroup')>()
  const { memo } = await import('react')
  const Real = actual.ToolCallGroup
  return {
    ...actual,
    ToolCallGroup: memo(function CountedToolCallGroup(props: Parameters<typeof Real>[0]) {
      const id = props.toolCalls[0]!.id
      counts.toolGroups[id] = (counts.toolGroups[id] ?? 0) + 1
      counts.toolGroupProps[id] = props
      return <Real {...props} />
    }),
  }
})

import { ChatInput } from './ChatInput'
import { StreamingIndicator } from './StreamingIndicator'
import { MessageList } from './MessageList'
import { PermissionDialog } from './PermissionDialog'
import { AskUserQuestion } from './AskUserQuestion'
import { useChatStore, useSessionRuntimeSelection, type PerSessionState } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import {
  HISTORY_GROUP_ID,
  LIVE_GROUP_ID,
  SCENARIO_SESSION_ID,
  SCENARIO_UPDATE_COUNT,
  installScenarioSession,
  playStreamingReply,
} from './streamingRenderScenario'

function Counted({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler id={id} onRender={() => { counts.commits[id] = (counts.commits[id] ?? 0) + 1 }}>
      {children}
    </Profiler>
  )
}

function resetCounts() {
  counts.commits = {}
  counts.toolGroups = {}
  counts.toolGroupProps = {}
}

function patchSession(update: Partial<PerSessionState>) {
  act(() => {
    useChatStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [SCENARIO_SESSION_ID]: { ...state.sessions[SCENARIO_SESSION_ID]!, ...update },
      },
    }))
  })
}

describe('render counts during one streaming reply', () => {
  const initialChatState = useChatStore.getInitialState()
  const initialTabState = useTabStore.getInitialState()

  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState(initialChatState, true)
    useTabStore.setState(initialTabState, true)
    installScenarioSession()
  })

  afterEach(() => {
    cleanup()
  })

  it('re-renders each component only when the fields it shows change', () => {
    render(
      <>
        <Counted id="ChatInput"><ChatInput /></Counted>
        <Counted id="StreamingIndicator"><StreamingIndicator /></Counted>
        <Counted id="MessageList"><MessageList sessionId={SCENARIO_SESSION_ID} /></Counted>
        <Counted id="PermissionDialog">
          <PermissionDialog sessionId={SCENARIO_SESSION_ID} requestId="perm-1" toolName="Bash" input={{ command: 'bun test' }} />
        </Counted>
        <Counted id="AskUserQuestion">
          <AskUserQuestion sessionId={SCENARIO_SESSION_ID} toolUseId="tu-question" input={{ questions: [] }} />
        </Counted>
      </>,
    )
    resetCounts()

    playStreamingReply()

    expect({
      ...counts.commits,
      historyToolGroup: counts.toolGroups[HISTORY_GROUP_ID] ?? 0,
      liveToolGroup: counts.toolGroups[LIVE_GROUP_ID] ?? 0,
    }).toEqual({
      ChatInput: 8,
      StreamingIndicator: 14,
      MessageList: 44,
      PermissionDialog: 2,
      historyToolGroup: 0,
      liveToolGroup: 4,
    })
    expect(SCENARIO_UPDATE_COUNT).toBe(31)
    expect(counts.toolGroupProps[LIVE_GROUP_ID]!.resultMap.get('tu-live')?.content).toBe('all passed')
  })
})

describe('components still update on the fields they use', () => {
  const initialChatState = useChatStore.getInitialState()
  const initialTabState = useTabStore.getInitialState()

  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState(initialChatState, true)
    useTabStore.setState(initialTabState, true)
    installScenarioSession()
    resetCounts()
  })

  afterEach(() => {
    cleanup()
  })

  it('ChatInput follows permissionMode, the effective mode and composerPrefill', () => {
    render(<ChatInput />)

    patchSession({ permissionMode: 'plan' })
    expect(screen.getByTestId('permission-mode')).toHaveAttribute('data-value', 'plan')

    const session = useChatStore.getState().sessions[SCENARIO_SESSION_ID]!
    patchSession({
      mirror: { ...session.mirror!, permission: { desired: 'plan', effective: 'acceptEdits' } },
    })
    expect(screen.getByTestId('permission-mode')).toHaveAttribute('data-effective', 'acceptEdits')

    patchSession({ composerPrefill: { text: 'try again', nonce: 1 } })
    expect(screen.getByRole('textbox')).toHaveValue('try again')
  })

  it('ChatInput follows slashCommands and chatState', () => {
    render(<ChatInput />)

    patchSession({ slashCommands: [{ name: 'deploy-now', description: 'Ship it' }] })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/deploy', selectionStart: 7 } })
    expect(screen.getAllByRole('button').some((button) => button.textContent?.startsWith('/deploy-now'))).toBe(true)

    expect(screen.queryByTitle('Stop generation (Cmd+.)')).not.toBeInTheDocument()
    patchSession({ chatState: 'streaming' })
    expect(screen.getByTitle('Stop generation (Cmd+.)')).toBeInTheDocument()
  })

  it('StreamingIndicator follows statusVerb, tokenUsage and apiRetry', () => {
    patchSession({ chatState: 'thinking' })
    render(<StreamingIndicator />)

    patchSession({ statusVerb: 'Pondering' })
    expect(screen.getByText('Pondering...')).toBeInTheDocument()

    patchSession({ tokenUsage: { input_tokens: 10, output_tokens: 42 } })
    expect(screen.getByText(/↓ 42/)).toBeInTheDocument()

    patchSession({
      apiRetry: {
        attempt: 1,
        maxRetries: 3,
        retryDelayMs: 1000,
        errorStatus: 529,
        receivedAt: Date.now(),
      } as PerSessionState['apiRetry'],
    })
    expect(screen.getByTestId('api-retry-indicator')).toBeInTheDocument()
  })

  it('PermissionDialog follows its pending request', () => {
    render(<PermissionDialog sessionId={SCENARIO_SESSION_ID} requestId="perm-1" toolName="Bash" input={{ command: 'ls' }} />)
    expect(screen.queryByText('Allow')).not.toBeInTheDocument()

    patchSession({ pendingPermission: { requestId: 'perm-1', toolName: 'Bash', input: { command: 'ls' } } })
    expect(screen.getByText('Allow')).toBeInTheDocument()

    patchSession({ pendingPermission: null })
    expect(screen.queryByText('Allow')).not.toBeInTheDocument()
  })

  it('AskUserQuestion follows its pending request', () => {
    render(
      <AskUserQuestion
        sessionId={SCENARIO_SESSION_ID}
        toolUseId="tu-question"
        input={{ questions: [{ question: 'Persist?', options: [{ label: 'No' }, { label: 'Yes' }] }] }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^No$/ }))
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled()

    patchSession({
      pendingPermission: { requestId: 'perm-q', toolName: 'AskUserQuestion', toolUseId: 'tu-question', input: {} },
    })
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled()
  })

  it('the runtime selection keeps its reference until the desired runtime changes', () => {
    const { result } = renderHook(() => useSessionRuntimeSelection(SCENARIO_SESSION_ID))
    const session = useChatStore.getState().sessions[SCENARIO_SESSION_ID]!
    patchSession({
      mirror: {
        ...session.mirror!,
        runtime: { desired: { providerId: 'p1', modelId: 'm1', effort: 'high' }, effective: null },
      } as PerSessionState['mirror'],
    })
    const first = result.current
    expect(first).toEqual({ providerId: 'p1', modelId: 'm1', effort: 'high' })

    patchSession({ streamingText: 'unrelated', mirror: { ...useChatStore.getState().sessions[SCENARIO_SESSION_ID]!.mirror! } })
    expect(result.current).toBe(first)

    const mirror = useChatStore.getState().sessions[SCENARIO_SESSION_ID]!.mirror!
    patchSession({
      mirror: { ...mirror, runtime: { desired: { providerId: 'p1', modelId: 'm2', effort: 'high' }, effective: null } } as PerSessionState['mirror'],
    })
    expect(result.current).toEqual({ providerId: 'p1', modelId: 'm2', effort: 'high' })
  })

  it('a tool group re-renders when its own result arrives', () => {
    render(<MessageList sessionId={SCENARIO_SESSION_ID} />)
    const session = useChatStore.getState().sessions[SCENARIO_SESSION_ID]!
    patchSession({
      messages: [
        ...session.messages,
        { id: LIVE_GROUP_ID, type: 'tool_use', toolName: 'Bash', toolUseId: 'tu-live', input: { command: 'ls' }, timestamp: 1 },
      ],
    })
    expect(counts.toolGroupProps[LIVE_GROUP_ID]!.resultMap.size).toBe(0)
    resetCounts()

    patchSession({
      messages: [
        ...useChatStore.getState().sessions[SCENARIO_SESSION_ID]!.messages,
        { id: 'r-live', type: 'tool_result', toolUseId: 'tu-live', content: 'files', isError: false, timestamp: 2 },
      ],
    })
    expect(counts.toolGroups[LIVE_GROUP_ID]).toBe(1)
    expect(counts.toolGroupProps[LIVE_GROUP_ID]!.resultMap.get('tu-live')?.content).toBe('files')
    expect(counts.toolGroups[HISTORY_GROUP_ID]).toBeUndefined()
  })
})
