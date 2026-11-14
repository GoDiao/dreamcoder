import { useSessionStore } from '../stores/sessionStore'
import { useWorkspacePanelStore, type WorkspaceTab } from '../stores/workspacePanelStore'

type SideChatTab = Extract<WorkspaceTab, { kind: 'sideChat' }>

export async function closeSideChat(parentId: string, tab: SideChatTab) {
  await useSessionStore.getState().deleteSession(tab.sessionId)
  useWorkspacePanelStore.getState().closeTab(parentId, tab.id)
}

export async function detachSideChat(parentId: string, tab: SideChatTab) {
  await useSessionStore.getState().detachSession(tab.sessionId)
  useWorkspacePanelStore.getState().closeTab(parentId, tab.id)
}
