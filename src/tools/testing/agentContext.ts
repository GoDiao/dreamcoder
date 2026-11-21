import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { ToolUseContext } from '../../Tool.js'
import { createFileStateCacheWithSizeLimit } from '../../utils/fileStateCache.js'
import type { FileWriteTool } from '../FileWriteTool/FileWriteTool.js'

export function agentContext(overrides: Partial<ToolUseContext> = {}): ToolUseContext {
  const appState = getDefaultAppState()
  let fileHistory = appState.fileHistory
  return {
    updateFileHistoryState: (update: (state: typeof fileHistory) => typeof fileHistory) => {
      fileHistory = update(fileHistory)
    },
    readFileState: createFileStateCacheWithSizeLimit(100),
    abortController: new AbortController(),
    getAppState: () => appState,
    setAppState: () => {},
    options: { tools: [], commands: [], mcpClients: [], agentDefinitions: { activeAgents: [], allAgents: [] }, isNonInteractiveSession: true },
    messages: [],
    ...overrides,
  } as unknown as ToolUseContext
}

export const allow = (async () => ({ behavior: 'allow' })) as unknown as Parameters<typeof FileWriteTool.call>[2]

export const turn = { uuid: 'turn-1' } as unknown as Parameters<typeof FileWriteTool.call>[3]
