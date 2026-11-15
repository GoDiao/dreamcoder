import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '../i18n'
import { useSessionStore } from '../stores/sessionStore'
import { useWorkspaceChatContextStore, type WorkspaceChatReference } from '../stores/workspaceChatContextStore'
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

export function useStartSideChat(parentId: string) {
  const t = useTranslation()
  const [starting, setStarting] = useState(false)
  const start = async (reference?: Omit<WorkspaceChatReference, 'id'>) => {
    setStarting(true)
    try {
      const sideChatId = await useWorkspacePanelStore.getState().createSideChat(parentId)
      if (reference) useWorkspaceChatContextStore.getState().addReference(sideChatId, reference)
    } catch (error) {
      toast.error(t('workspace.sideChat.createFailed', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setStarting(false)
    }
  }
  return { starting, start }
}
