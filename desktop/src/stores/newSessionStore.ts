import { create } from 'zustand'
import type { ComposerAttachment } from '../lib/composerAttachments'
import type { PermissionMode } from '../types/settings'
import { useSessionStore } from './sessionStore'
import { useChatStore } from './chatStore'
import { DRAFT_RUNTIME_SELECTION_KEY, useSessionRuntimeStore } from './sessionRuntimeStore'
import { useTabStore } from './tabStore'

type NewSessionDraft = {
  input: string
  attachments: ComposerAttachment[]
  workDir: string
  branch: string | null
  useWorktree: boolean
  permissionMode: PermissionMode | null
}

const emptyDraft: NewSessionDraft = {
  input: '',
  attachments: [],
  workDir: '',
  branch: null,
  useWorktree: false,
  permissionMode: null,
}

type NewSessionStore = NewSessionDraft & {
  isSubmitting: boolean
  createdSessionId: string | null
  updateDraft: (update: Partial<NewSessionDraft> | ((draft: NewSessionDraft) => Partial<NewSessionDraft>)) => void
  setWorkDir: (workDir: string) => void
  open: (workDir?: string) => void
  submit: (permissionMode: PermissionMode, title: string) => Promise<void>
}

export const useNewSessionStore = create<NewSessionStore>((set, get) => ({
  ...emptyDraft,
  isSubmitting: false,
  createdSessionId: null,
  updateDraft: (update) => {
    if (get().isSubmitting) return
    set(typeof update === 'function' ? update(get()) : update)
  },
  setWorkDir: (workDir) => {
    if (get().isSubmitting || get().createdSessionId || get().workDir === workDir) return
    set({ workDir, branch: null, useWorktree: false })
  },
  open: (workDir) => {
    const draft = get()
    if (workDir !== undefined) {
      draft.setWorkDir(workDir)
    } else if (!draft.input && draft.attachments.length === 0) {
      const activeId = useTabStore.getState().activeTabId
      const session = useSessionStore.getState().sessions.find((item) => item.id === activeId)
      const inherited = session?.workDir || session?.projectRoot
      if (inherited) draft.setWorkDir(inherited)
    }
    useSessionStore.getState().setActiveSession(null)
    useTabStore.getState().setActiveTab(null)
  },
  submit: async (permissionMode, title) => {
    const draft = get()
    const text = draft.input.trim()
    if (draft.isSubmitting || (!text && draft.attachments.length === 0)) return
    set({ isSubmitting: true })
    try {
      const runtime = useSessionRuntimeStore.getState().selections[DRAFT_RUNTIME_SELECTION_KEY]
      const sessionId = draft.createdSessionId ?? await useSessionStore.getState().createSession(draft.workDir || undefined, {
        ...(draft.branch ? { repository: { branch: draft.branch, worktree: draft.useWorktree } } : {}),
        permissionMode,
        ...(runtime ? { runtime } : {}),
      })
      set({ createdSessionId: sessionId })
      useChatStore.getState().connectToSession(sessionId)
      useChatStore.getState().sendMessage(sessionId, text, draft.attachments.map((attachment) => ({
        type: attachment.type,
        name: attachment.name,
        path: attachment.path,
        data: attachment.data,
        mimeType: attachment.mimeType,
      })))
      useSessionRuntimeStore.getState().clearSelection(DRAFT_RUNTIME_SELECTION_KEY)
      set({ ...emptyDraft, createdSessionId: null })
      const destinationTabId = useTabStore.getState().activeTabId
      const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId)
      useTabStore.getState().openTab(sessionId, session?.title || title)
      if (destinationTabId !== null) useTabStore.getState().setActiveTab(destinationTabId)
    } finally {
      set({ isSubmitting: false })
    }
  },
}))
