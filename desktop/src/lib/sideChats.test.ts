import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../stores/sessionStore'
import { useWorkspacePanelStore, type WorkspaceTab } from '../stores/workspacePanelStore'
import { closeSideChat, detachSideChat } from './sideChats'

type SideChatTab = Extract<WorkspaceTab, { kind: 'sideChat' }>

function openSideChat(): SideChatTab {
  const id = useWorkspacePanelStore.getState().openTab('parent', { kind: 'sideChat', sessionId: 'side' })
  return { id, kind: 'sideChat', sessionId: 'side' }
}

function openTabIds() {
  return useWorkspacePanelStore.getState().panelByTab.parent?.tabs.map((tab) => tab.id) ?? []
}

describe.each([
  ['closeSideChat', closeSideChat, 'deleteSession'],
  ['detachSideChat', detachSideChat, 'detachSession'],
] as const)('%s', (_name, action, storeAction) => {
  afterEach(() => {
    vi.restoreAllMocks()
    useWorkspacePanelStore.setState(useWorkspacePanelStore.getInitialState(), true)
    localStorage.clear()
  })

  it('closes the tab once the server has the change', async () => {
    const tab = openSideChat()
    const call = vi.spyOn(useSessionStore.getState(), storeAction).mockResolvedValue()

    await action('parent', tab)

    expect(call).toHaveBeenCalledWith('side')
    expect(openTabIds()).toEqual([])
  })

  it('keeps the tab when the server refuses the change', async () => {
    const tab = openSideChat()
    vi.spyOn(useSessionStore.getState(), storeAction).mockRejectedValue(new Error('refused'))

    await expect(action('parent', tab)).rejects.toThrow('refused')

    expect(openTabIds()).toEqual([tab.id])
  })
})
