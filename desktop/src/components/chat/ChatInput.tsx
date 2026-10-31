import { TriangleAlertIcon } from 'lucide-react'
import { Button } from '../shared/ui/button'
import { ComposerPopover } from './ComposerPopover'
import { Tooltip as HintTooltip } from '../shared/Tooltip'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from '../../i18n'
import {
  sessionRuntimeSelection,
  useChatStore,
  useSessionField,
  useSessionRuntimeSelection,
  type PerSessionState,
} from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTeamStore } from '../../stores/teamStore'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  formatWorkspaceReferencePrompt,
  useWorkspaceChatContextStore,
  type WorkspaceChatReference,
} from '../../stores/workspaceChatContextStore'
import { sessionsApi, type SessionGitInfo } from '../../api/sessions'
import { PermissionModeSelector } from '../controls/PermissionModeSelector'
import { ModelSelector } from '../controls/ModelSelector'
import type { AttachmentRef } from '../../types/chat'
import { refreshBrowserMarksBeforeSend } from '../../lib/browserMarks'
import { browserReferenceAttachment } from '../../lib/browserReferenceView'
import { AttachmentGallery } from './AttachmentGallery'
import { ComposerDropOverlay } from './ComposerDropOverlay'
import { RepositoryLaunchControls, type RepositoryLaunchError } from '../shared/RepositoryLaunchControls'
import { FileSearchMenu, type FileSearchMenuHandle } from './FileSearchMenu'
import { LocalSlashCommandPanel, type LocalSlashCommandName } from './LocalSlashCommandPanel'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import { ProviderGateCard, useProviderMissing } from './ProviderRequiredNotice'
import { ComposerBox, ComposerControls, resizeComposerTextarea } from './ComposerShell'
import { ProjectLabel } from './ProjectLabel'
import {
  FALLBACK_SLASH_COMMANDS,
  filterSlashCommands,
  findSlashTrigger,
  mergeSlashCommands,
  replaceSlashToken,
  resolveRepositoryLaunchError,
  resolveSlashUiAction,
} from './composerUtils'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { useTypeToFocus } from '../../hooks/useTypeToFocus'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import {
  filesToComposerAttachments,
  selectNativeFileAttachments,
  type ComposerAttachment,
} from '../../lib/composerAttachments'
import { useComposerFileDrop } from './useComposerFileDrop'

type GitInfo = SessionGitInfo

type Attachment = ComposerAttachment

type ChatInputProps = {
  variant?: 'default' | 'hero'
  compact?: boolean
}

const EMPTY_WORKSPACE_REFERENCES: WorkspaceChatReference[] = []
const EMPTY_SLASH_COMMANDS: PerSessionState['slashCommands'] = []

function workspaceReferenceToAttachment(reference: WorkspaceChatReference, pendingLabel: string): Attachment {
  if (reference.kind === 'browser' && reference.browser) {
    if (reference.browser.pendingPickId) return { id: reference.id, type: 'file', name: pendingLabel }
    return {
      id: reference.id,
      ...browserReferenceAttachment({ browser: reference.browser, note: reference.note }),
      previewUrl: reference.browser.element?.screenshot?.data,
    }
  }
  return {
    id: reference.id,
    name: reference.name,
    type: 'file',
    path: reference.kind === 'chat-selection' ? undefined : reference.path,
    isDirectory: reference.isDirectory,
    lineStart: reference.lineStart,
    lineEnd: reference.lineEnd,
    note: reference.note,
    quote: reference.quote,
  }
}

function insertComposerTokenAtRange(value: string, start: number, end: number, token: string) {
  const boundedStart = Math.max(0, Math.min(start, value.length))
  const boundedEnd = Math.max(boundedStart, Math.min(end, value.length))
  const before = value.slice(0, boundedStart)
  const after = value.slice(boundedEnd)
  const leadingSpace = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trailingSpace = after.length > 0 && !/^\s/.test(after) ? ' ' : ''
  const insertion = `${leadingSpace}${token}${trailingSpace}`

  return {
    value: `${before}${insertion}${after}`,
    cursorPos: before.length + insertion.length,
  }
}

export function ChatInput({ variant = 'default', compact = false }: ChatInputProps) {
  const t = useTranslation()
  const isMobileComposer = useMobileViewport() && !isDesktopRuntime()
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [localSlashPanel, setLocalSlashPanel] = useState<LocalSlashCommandName | null>(null)
  const [atFilter, setAtFilter] = useState('')
  const [atCursorPos, setAtCursorPos] = useState(-1)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [launchWorkDir, setLaunchWorkDir] = useState('')
  const [launchBranch, setLaunchBranch] = useState<string | null>(null)
  const [launchUseWorktree, setLaunchUseWorktree] = useState(false)
  const [launchReady, setLaunchReady] = useState(true)
  const [launchTransitioning, setLaunchTransitioning] = useState(false)
  const [launchError, setLaunchError] = useState<RepositoryLaunchError | null>(null)
  const [noticeSlot, setNoticeSlot] = useState<HTMLDivElement | null>(null)
  const composingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useTypeToFocus(textareaRef, !isMobileComposer)
  const panelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileSearchRef = useRef<FileSearchMenuHandle>(null)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const previousActiveTabIdRef = useRef<string | null>(null)
  const inputRef = useRef(input)
  const attachmentsRef = useRef(attachments)
  const setComposerInput = useCallback((value: string) => {
    inputRef.current = value
    setInput(value)
  }, [])
  const setComposerAttachments = useCallback((value: Attachment[] | ((previous: Attachment[]) => Attachment[])) => {
    setAttachments((previous) => {
      const next = typeof value === 'function' ? value(previous) : value
      attachmentsRef.current = next
      return next
    })
  }, [])
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const clearComposerInsertion = useChatStore((s) => s.clearComposerInsertion)
  const setSessionPermissionMode = useChatStore((s) => s.setSessionPermissionMode)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const chatState = useSessionField(activeTabId, 'chatState') ?? 'idle'
  const slashCommands = useSessionField(activeTabId, 'slashCommands') ?? EMPTY_SLASH_COMMANDS
  const composerPrefill = useSessionField(activeTabId, 'composerPrefill') ?? null
  const composerInsertion = useSessionField(activeTabId, 'composerInsertion') ?? null
  const defaultPermissionMode = useSettingsStore((s) => s.permissionMode)
  const permissionMode = useSessionField(activeTabId, 'permissionMode') ?? defaultPermissionMode
  const effectivePermissionMode = useChatStore((s) =>
    activeTabId ? s.sessions[activeTabId]?.mirror?.permission.effective ?? undefined : undefined,
  )
  const runtimeSelection = useSessionRuntimeSelection(activeTabId)
  const currentModel = useSettingsStore((state) => state.currentModel)
  const runtimeSelectionKey = runtimeSelection
    ? `${runtimeSelection.providerId ?? 'none'}:${runtimeSelection.modelId}`
    : undefined
  const providerMissing = useProviderMissing(runtimeSelection)
  const runtimeModelLabel = runtimeSelection?.modelId || currentModel?.name || currentModel?.id
  const activeSession = useSessionStore((state) => activeTabId ? state.sessions.find((session) => session.id === activeTabId) ?? null : null)
  const loadedMessageCount = useChatStore((s) => activeTabId ? s.sessions[activeTabId]?.messages?.length ?? 0 : 0)
  const messageCount = Math.max(loadedMessageCount, activeSession?.messageCount ?? 0)
  const memberInfo = useTeamStore((s) => activeTabId ? s.getMemberBySessionId(activeTabId) : null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const workspaceReferences = useWorkspaceChatContextStore(
    (s) => activeTabId ? s.referencesBySession[activeTabId] ?? EMPTY_WORKSPACE_REFERENCES : EMPTY_WORKSPACE_REFERENCES,
  )
  const addWorkspaceReference = useWorkspaceChatContextStore((s) => s.addReference)
  const removeWorkspaceReference = useWorkspaceChatContextStore((s) => s.removeReference)
  const clearWorkspaceReferences = useWorkspaceChatContextStore((s) => s.clearReferences)
  const saveComposerDraft = useCallback((sessionId: string) => {
    const draft = {
      input: inputRef.current,
      attachments: attachmentsRef.current,
    }
    const chatStore = useChatStore.getState()
    if (draft.input.length === 0 && draft.attachments.length === 0) {
      chatStore.clearComposerDraft(sessionId)
      return
    }
    chatStore.setComposerDraft(sessionId, draft)
  }, [])

  const isMemberSession = !!memberInfo
  const isActive = chatState !== 'idle'
  const isWorkspaceMissing = activeSession?.workDirExists === false
  const hasWorkspaceReferences = !isMemberSession && workspaceReferences.length > 0
  const isHeroComposer = variant === 'hero' && !isMemberSession && !compact
  const resolvedWorkDir = activeSession?.workDir || gitInfo?.workDir || undefined
  const showLaunchControls = !isMemberSession && messageCount === 0
  const useCompactControls = compact || isMobileComposer
  const activeLaunchWorkDir = showLaunchControls ? (launchWorkDir || resolvedWorkDir || '') : (resolvedWorkDir || '')
  const pendingSlashUiAction = !isMemberSession && input.trim().startsWith('/')
    ? resolveSlashUiAction(input.trim().slice(1))
    : null
  const canSubmit = !isWorkspaceMissing &&
    !launchTransitioning &&
    (!showLaunchControls || launchReady || !!pendingSlashUiAction) &&
    (input.trim().length > 0 || (!isMemberSession && (attachments.length > 0 || hasWorkspaceReferences)))
  const pickingLabel = t('browser.picking')
  const composerAttachments = useMemo(
    () => [
      ...attachments,
      ...workspaceReferences.map((reference) => workspaceReferenceToAttachment(reference, pickingLabel)),
    ],
    [attachments, workspaceReferences, pickingLabel],
  )
  const slashCommandCount = slashCommands.length

  useEffect(() => {
    inputRef.current = input
  }, [input])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    const previousActiveTabId = previousActiveTabIdRef.current

    if (previousActiveTabId === activeTabId) return

    if (previousActiveTabId) {
      saveComposerDraft(previousActiveTabId)
    }

    const nextDraft = activeTabId ? useChatStore.getState().sessions[activeTabId]?.composerDraft : undefined
    setComposerInput(nextDraft?.input ?? '')
    setComposerAttachments(nextDraft?.attachments ?? [])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setLocalSlashPanel(null)
    setSlashFilter('')
    setAtFilter('')
    setAtCursorPos(-1)
    setLaunchError(null)
    previousActiveTabIdRef.current = activeTabId
  }, [activeTabId, saveComposerDraft, setComposerAttachments, setComposerInput])

  useEffect(() => {
    return () => {
      const currentActiveTabId = previousActiveTabIdRef.current
      if (currentActiveTabId) saveComposerDraft(currentActiveTabId)
    }
  }, [saveComposerDraft])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [isActive])

  useEffect(() => {
    if (!composerPrefill) return

    setComposerInput(composerPrefill.text)
    setComposerAttachments(
      (composerPrefill.attachments ?? [])
        .filter((attachment) => attachment.type === 'image' || attachment.data)
        .map((attachment, index) => ({
          id: `rewind-prefill-${composerPrefill.nonce}-${index}`,
          name: attachment.name,
          type: attachment.type,
          mimeType: attachment.mimeType,
          previewUrl: attachment.type === 'image' ? attachment.data : undefined,
          data: attachment.data,
        })),
    )
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setSlashFilter('')
    setAtFilter('')
    setAtCursorPos(-1)

    requestAnimationFrame(() => {
      const el = textareaRef.current
      el?.focus()
      const cursor = composerPrefill.text.length
      el?.setSelectionRange(cursor, cursor)
    })
  }, [composerPrefill, setComposerAttachments, setComposerInput])

  useEffect(() => {
    if (!composerInsertion || !activeTabId || isMemberSession) return

    const el = textareaRef.current
    const currentInput = inputRef.current
    const start = el?.selectionStart ?? currentInput.length
    const end = el?.selectionEnd ?? start
    const next = insertComposerTokenAtRange(currentInput, start, end, composerInsertion.text)

    if (composerInsertion.reference) {
      addWorkspaceReference(activeTabId, composerInsertion.reference)
    }
    setComposerInput(next.value)
    setFileSearchOpen(false)
    setSlashMenuOpen(false)
    setAtFilter('')
    setAtCursorPos(-1)
    clearComposerInsertion(activeTabId, composerInsertion.nonce)

    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.cursorPos, next.cursorPos)
    })
  }, [
    activeTabId,
    addWorkspaceReference,
    clearComposerInsertion,
    composerInsertion,
    isMemberSession,
    setComposerInput,
  ])

  const refreshGitInfo = useCallback(() => {
    if (!activeTabId) {
      setGitInfo(null)
      return
    }
    if (isMemberSession) {
      setGitInfo(null)
      return
    }
    sessionsApi.getGitInfo(activeTabId).then(setGitInfo).catch(() => setGitInfo(null))
  }, [activeTabId, isMemberSession])

  useEffect(() => {
    refreshGitInfo()
  }, [refreshGitInfo])

  useEffect(() => {
    if (!activeTabId || isMemberSession || messageCount === 0) return
    const timeout = setTimeout(refreshGitInfo, chatState === 'idle' ? 0 : 500)
    return () => clearTimeout(timeout)
  }, [activeTabId, chatState, isMemberSession, messageCount, refreshGitInfo, slashCommandCount])

  useEffect(() => {
    if (!isMemberSession) return
    setComposerAttachments([])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
  }, [isMemberSession, activeTabId])

  useEffect(() => {
    if (!showLaunchControls) return
    const nextWorkDir = activeSession?.workDir || gitInfo?.workDir || ''
    setLaunchWorkDir((current) => {
      if (current === nextWorkDir) return current
      setLaunchBranch(null)
      setLaunchUseWorktree(false)
      setLaunchReady(!nextWorkDir)
      return nextWorkDir
    })
  }, [activeSession?.workDir, activeTabId, gitInfo?.workDir, showLaunchControls])

  useEffect(() => {
    resizeComposerTextarea(textareaRef.current)
  }, [input, providerMissing])








  const allSlashCommands = useMemo(
    () => mergeSlashCommands(slashCommands, FALLBACK_SLASH_COMMANDS),
    [slashCommands],
  )

  const filteredCommands = useMemo(() => {
    return filterSlashCommands(allSlashCommands, slashFilter)
  }, [allSlashCommands, slashFilter])

  const exactSlashCommand = useMemo(() => {
    const normalized = slashFilter.trim().toLowerCase()
    if (!normalized) return null
    return filteredCommands.find((command) => command.name.toLowerCase() === normalized) ?? null
  }, [filteredCommands, slashFilter])

  useEffect(() => {
    setSlashSelectedIndex(0)
  }, [slashFilter])

  useEffect(() => {
    const activeItem = slashMenuOpen ? slashItemRefs.current[slashSelectedIndex] : null
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' })
    }
  }, [slashMenuOpen, slashSelectedIndex])

  const detectSlashTrigger = useCallback((value: string, cursorPos: number) => {
    const token = findSlashTrigger(value, cursorPos)
    if (!token) {
      setSlashMenuOpen(false)
      return
    }

    setFileSearchOpen(false)
    setSlashFilter(token.filter)
    setSlashMenuOpen(true)
  }, [])

  const detectAtTrigger = useCallback((value: string, cursorPos: number) => {
    const textBeforeCursor = value.slice(0, cursorPos)
    let pos = -1

    for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
      const ch = textBeforeCursor[i]!
      if (ch === '@') {
        if (i === 0 || /\s/.test(textBeforeCursor[i - 1]!)) {
          pos = i
          break
        }
        break
      }
      if (/\s/.test(ch)) {
        break
      }
    }

    if (pos < 0) {
      setFileSearchOpen(false)
      setAtFilter('')
      setAtCursorPos(-1)
      return
    }

    const filter = textBeforeCursor.slice(pos + 1)
    setAtFilter(filter)
    setAtCursorPos(pos)
    setSlashMenuOpen(false)
    setFileSearchOpen(true)
  }, [])

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    if (isMemberSession) {
      setComposerInput(value)
      return
    }
    const cursorPos = event.target.selectionStart ?? value.length
    setComposerInput(value)
    detectSlashTrigger(value, cursorPos)
    detectAtTrigger(value, cursorPos)
  }

  const selectSlashCommand = useCallback((command: string) => {
    const el = textareaRef.current
    if (!el) return
    const cursorPos = el.selectionStart ?? input.length
    const replacement = replaceSlashToken(input, cursorPos, command)
    setComposerInput(replacement.value)
    setSlashMenuOpen(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }, [input])

  const replaceEmptySession = useCallback(async (
    workDir: string,
    repository?: { branch?: string | null; worktree?: boolean },
  ) => {
    if (!activeTabId) return null
    const oldId = activeTabId
    const { createSession, deleteSession } = useSessionStore.getState()
    const { replaceTabSession } = useTabStore.getState()
    const { disconnectSession, connectToSession, sessions } = useChatStore.getState()
    const permissionMode = sessions[oldId]?.permissionMode
    const runtime = sessionRuntimeSelection(sessions[oldId])
    const newId = await createSession(workDir || undefined, {
      ...(repository ? { repository } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(runtime ? { runtime } : {}),
    })
    disconnectSession(oldId)
    replaceTabSession(oldId, newId)
    connectToSession(newId)
    deleteSession(oldId).catch(() => {})
    return newId
  }, [activeTabId])

  const handleLaunchWorkDirChange = useCallback(async (newWorkDir: string) => {
    setLaunchWorkDir(newWorkDir)
    setLaunchBranch(null)
    setLaunchUseWorktree(false)
    setLaunchReady(!newWorkDir)
    setLaunchError(null)
    if (!activeTabId) return

    setLaunchTransitioning(true)
    try {
      await replaceEmptySession(newWorkDir)
    } catch (error) {
      useUIStore.getState().addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('empty.failedToCreate'),
      })
    } finally {
      setLaunchTransitioning(false)
    }
  }, [activeTabId, replaceEmptySession, t])

  const handleSubmit = async () => {
    const text = input.trim()
    if ((!text && ((!attachments.length && !hasWorkspaceReferences) || isMemberSession)) || isWorkspaceMissing) return

    if (pendingSlashUiAction?.type === 'panel') {
      setLocalSlashPanel(pendingSlashUiAction.command as LocalSlashCommandName)
      setComposerInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    if (pendingSlashUiAction?.type === 'settings') {
      useUIStore.getState().openSettings(pendingSlashUiAction.tab)
      setComposerInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    if (showLaunchControls && (!launchReady || launchTransitioning)) return

    if (providerMissing) {
      useUIStore.getState().addToast({ type: 'warning', message: t('chat.providerRequired.blocked') })
      return
    }

    const blockedByPendingPick = (items: WorkspaceChatReference[]) => {
      const pending = items.some((reference) => reference.browser?.pendingPickId)
      if (pending) useUIStore.getState().addToast({ type: 'warning', message: t('chat.browserPickPending') })
      return pending
    }

    if (hasWorkspaceReferences && blockedByPendingPick(workspaceReferences)) return

    if (hasWorkspaceReferences && workspaceReferences.some((reference) => reference.browser?.element)) {
      await refreshBrowserMarksBeforeSend(activeTabId!)
    }
    const references = useWorkspaceChatContextStore.getState().referencesBySession[activeTabId!] ?? EMPTY_WORKSPACE_REFERENCES
    if (blockedByPendingPick(references)) return

    const workspaceReferencePrompt = !isMemberSession
      ? formatWorkspaceReferencePrompt(references)
      : ''
    const contentForModel = [workspaceReferencePrompt, text].filter(Boolean).join('\n\n')
    const displayContent = text || (
      references.length > 0
        ? t('chat.contextReferencesOnly', { count: references.length })
        : ''
    )
    const uploadAttachmentPayload: AttachmentRef[] = attachments.map((attachment) => ({
      type: attachment.type,
      name: attachment.name,
      path: attachment.path,
      data: attachment.data,
      mimeType: attachment.mimeType,
      lineStart: attachment.lineStart,
      lineEnd: attachment.lineEnd,
      note: attachment.note,
      quote: attachment.quote,
    }))
    const browserScreenshotPayload: AttachmentRef[] = references.flatMap((reference) => {
      const screenshot = reference.browser?.element?.screenshot
      return reference.kind === 'browser' && screenshot
        ? [{ type: 'image' as const, name: `${reference.id.slice(0, 40)}.${screenshot.mimeType.split('/')[1] ?? 'png'}`, data: screenshot.data, mimeType: screenshot.mimeType }]
        : []
    })
    const workspaceAttachmentPayload: AttachmentRef[] = references
      .filter((reference) => reference.kind !== 'chat-selection' && reference.kind !== 'browser')
      .map((reference) => ({
        type: 'file' as const,
        name: reference.name,
        path: reference.absolutePath ?? reference.path,
        isDirectory: reference.isDirectory,
        lineStart: reference.lineStart,
        lineEnd: reference.lineEnd,
        note: reference.note,
        quote: reference.quote,
      }))
    const visibleAttachmentPayload: AttachmentRef[] = [
      ...uploadAttachmentPayload,
      ...references.map((reference): AttachmentRef => {
        if (reference.kind === 'browser' && reference.browser) {
          return browserReferenceAttachment({ browser: reference.browser, note: reference.note })
        }
        return {
          type: 'file' as const,
          name: reference.name,
          path: reference.kind === 'chat-selection' ? undefined : reference.path,
          isDirectory: reference.isDirectory,
          lineStart: reference.lineStart,
          lineEnd: reference.lineEnd,
          note: reference.note,
          quote: reference.quote,
        }
      }),
    ]

    let targetSessionId = activeTabId!
    if (showLaunchControls && activeLaunchWorkDir && launchBranch) {
      const shouldReplaceForRepositoryLaunch =
        launchUseWorktree ||
        (gitInfo?.branch ? launchBranch !== gitInfo.branch : true)
      if (shouldReplaceForRepositoryLaunch) {
        setLaunchTransitioning(true)
        try {
          const newSessionId = await replaceEmptySession(activeLaunchWorkDir, {
            branch: launchBranch,
            worktree: launchUseWorktree,
          })
          if (!newSessionId) return
          targetSessionId = newSessionId
        } catch (error) {
          const repositoryError = resolveRepositoryLaunchError(error, t)
          if (repositoryError) {
            setLaunchError(repositoryError)
          } else {
            useUIStore.getState().addToast({
              type: 'error',
              message: error instanceof Error ? error.message : t('empty.failedToCreate'),
            })
          }
          return
        } finally {
          setLaunchTransitioning(false)
        }
      }
    }

    sendMessage(targetSessionId, contentForModel, [...uploadAttachmentPayload, ...workspaceAttachmentPayload, ...browserScreenshotPayload], {
      displayContent,
      displayAttachments: visibleAttachmentPayload,
    })
    setComposerInput('')
    setComposerAttachments([])
    useChatStore.getState().clearComposerDraft(activeTabId!)
    if (targetSessionId !== activeTabId) useChatStore.getState().clearComposerDraft(targetSessionId)
    if (!isMemberSession) {
      clearWorkspaceReferences(activeTabId!)
      if (targetSessionId !== activeTabId) clearWorkspaceReferences(targetSessionId)
    }
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
    setLocalSlashPanel(null)
    setLaunchError(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return

    if (fileSearchOpen) {
      const key = event.key
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'ArrowRight' || key === 'Enter' || key === 'Tab' || key === 'Escape') {
        event.preventDefault()
        if (key === 'Escape') {
          setFileSearchOpen(false)
          setAtFilter('')
          setAtCursorPos(-1)
          return
        }
        fileSearchRef.current?.handleKeyDown(event.nativeEvent)
        return
      }
      return
    }

    if (localSlashPanel) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setLocalSlashPanel(null)
        return
      }
    }

    if (slashMenuOpen && filteredCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashSelectedIndex((prev) => (prev + 1) % filteredCommands.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (event.key === 'Enter') {
        if (exactSlashCommand && slashFilter.trim().toLowerCase() === exactSlashCommand.name.toLowerCase()) {
          event.preventDefault()
          handleSubmit()
          return
        }
        event.preventDefault()
        const selected = filteredCommands[slashSelectedIndex]
        if (selected) selectSlashCommand(selected.name)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const selected = filteredCommands[slashSelectedIndex]
        if (selected) selectSlashCommand(selected.name)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashMenuOpen(false)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    if (isMemberSession) return
    const items = event.clipboardData?.items
    if (!items) return

    let hasImage = false
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item || !item.type.startsWith('image/')) continue

      hasImage = true
      event.preventDefault()
      const file = item.getAsFile()
      if (!file) continue

      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const reader = new FileReader()
      reader.onload = () => {
        setComposerAttachments((prev) => [
          ...prev,
          {
            id,
            name: `pasted-image-${Date.now()}.png`,
            type: 'image',
            mimeType: file.type || 'image/png',
            previewUrl: reader.result as string,
            data: reader.result as string,
          },
        ])
      }
      reader.readAsDataURL(file)
    }

    if (!hasImage) return
  }

  const appendFiles = useCallback((files: FileList | File[]) => {
    void filesToComposerAttachments(files)
      .then((nextAttachments) => {
        if (nextAttachments.length === 0) return
        setComposerAttachments((prev) => [...prev, ...nextAttachments])
      })
      .catch((error) => {
        console.warn('[attachments] Failed to read selected files', error)
      })
  }, [setComposerAttachments])

  const appendAttachments = useCallback((nextAttachments: Attachment[]) => {
    if (nextAttachments.length === 0) return
    setComposerAttachments((prev) => [...prev, ...nextAttachments])
  }, [setComposerAttachments])

  const { isDragActive, dragHandlers } = useComposerFileDrop({
    disabled: isMemberSession || isWorkspaceMissing,
    onAttachments: appendAttachments,
    onError: (error) => {
      console.warn('[attachments] Failed to read dropped files', error)
    },
  })

  const openAttachmentPicker = useCallback(() => {
    if (!isDesktopRuntime()) {
      fileInputRef.current?.click()
      setPlusMenuOpen(false)
      return
    }

    void selectNativeFileAttachments()
      .then((nativeAttachments) => {
        if (nativeAttachments) {
          if (nativeAttachments.length > 0) {
            setComposerAttachments((prev) => [...prev, ...nativeAttachments])
          }
          return
        }
        fileInputRef.current?.click()
      })
      .finally(() => setPlusMenuOpen(false))
  }, [setComposerAttachments])

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (isMemberSession) return
    const files = event.target.files
    if (!files) return

    appendFiles(files)
    event.target.value = ''
  }

  const removeAttachment = (id: string) => {
    setComposerAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
    if (activeTabId) removeWorkspaceReference(activeTabId, id)
  }

  const insertSlashCommand = () => {
    if (isMemberSession) return
    const el = textareaRef.current
    const cursorPos = el?.selectionStart ?? input.length
    const replacement = replaceSlashToken(input, cursorPos, '', { trailingSpace: false })
    setComposerInput(replacement.value)
    setPlusMenuOpen(false)
    setSlashFilter('')
    setSlashMenuOpen(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  const composerPlaceholder =
    isHeroComposer
      ? t('empty.placeholder')
      : isWorkspaceMissing
        ? t('chat.placeholderMissing')
        : isMemberSession
          ? t('teams.memberPlaceholder')
          : t('chat.placeholder')

  const addFilesLabel = isHeroComposer ? t('empty.addFiles') : t('chat.addFiles')
  const slashCommandsLabel = isHeroComposer ? t('empty.slashCommands') : t('chat.slashCommands')


  const isStopAction = !isMemberSession && isActive
  const actionLabel = isStopAction ? t('common.stop') : isMemberSession ? t('common.send') : t('common.run')

  const overlays = (
    <>
      {isDragActive && (
        <ComposerDropOverlay
          testId="chat-input-drop-overlay"
          title={t('chat.dropFilesTitle')}
          description={t('chat.dropFilesHint')}
        />
      )}

      {!isMemberSession && fileSearchOpen && (
        <ComposerPopover anchorRef={panelRef} inputRef={textareaRef} label={t('fileSearch.title')} onClose={() => setFileSearchOpen(false)} preserveInputFocus><FileSearchMenu
          ref={fileSearchRef}
          cwd={activeLaunchWorkDir || resolvedWorkDir || ''}
          filter={atFilter}
          compact={isMobileComposer}
          onNavigate={(relativePath) => {
            if (atCursorPos < 0) return
            const replacement = `@${relativePath}`
            const tokenEnd = atCursorPos + 1 + atFilter.length
            const newValue = `${input.slice(0, atCursorPos)}${replacement}${input.slice(tokenEnd)}`
            const newCursorPos = atCursorPos + replacement.length
            setComposerInput(newValue)
            setAtFilter(relativePath)
            requestAnimationFrame(() => {
              textareaRef.current?.focus()
              textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos)
            })
          }}
          onSelect={(path, name, isDirectory) => {
            if (atCursorPos >= 0) {
              const referenceName = name.split('/').filter(Boolean).pop() ?? name
              const tokenEnd = atCursorPos + 1 + atFilter.length
              const beforeToken = input.slice(0, atCursorPos)
              const afterToken = beforeToken ? input.slice(tokenEnd) : input.slice(tokenEnd).replace(/^\s+/, '')
              const spacer = beforeToken && afterToken && !/\s$/.test(beforeToken) && !/^\s/.test(afterToken) ? ' ' : ''
              const newValue = `${beforeToken}${spacer}${afterToken}`
              const newCursorPos = atCursorPos + spacer.length
              if (activeTabId) {
                addWorkspaceReference(activeTabId, {
                  kind: 'file',
                  path,
                  absolutePath: path,
                  name: isDirectory ? `${referenceName}/` : referenceName,
                  isDirectory,
                })
              }
              setComposerInput(newValue)
              setFileSearchOpen(false)
              setAtFilter('')
              setAtCursorPos(-1)
              void textareaRef.current?.focus()
              requestAnimationFrame(() => {
                textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos)
              })
            }
          }}
        /></ComposerPopover>
      )}

      {!isMemberSession && localSlashPanel && (
        <ComposerPopover anchorRef={panelRef} inputRef={textareaRef} label={t('chat.slashCommands')} onClose={() => setLocalSlashPanel(null)}><LocalSlashCommandPanel
          command={localSlashPanel}
          sessionId={activeTabId ?? undefined}
          cwd={activeLaunchWorkDir || resolvedWorkDir}
          commands={allSlashCommands}
          onClose={() => setLocalSlashPanel(null)}
        /></ComposerPopover>
      )}

      {!isMemberSession && slashMenuOpen && filteredCommands.length > 0 && (
        <ComposerPopover anchorRef={panelRef} inputRef={textareaRef} label={t('chat.slashCommands')} onClose={() => setSlashMenuOpen(false)} preserveInputFocus><div
          className="overflow-hidden bg-ui-popover"
        >
          <div className="max-h-[300px] overflow-y-auto p-1">
            {filteredCommands.map((command, index) => (
              <Button variant="ghost" size="row"
                key={command.name}
                ref={(el) => { slashItemRefs.current[index] = el }}
                onClick={() => selectSlashCommand(command.name)}
                onMouseEnter={() => setSlashSelectedIndex(index)}
                className={`items-center gap-3 px-3 ${
                  index === slashSelectedIndex ? 'bg-[var(--color-surface-hover)]' : ''
                }`}
              >
                <span className="flex min-w-0 max-w-[52%] shrink-0 items-baseline gap-1.5">
                  <span className="shrink-0 text-ui-body font-medium text-[var(--color-text-primary)]">
                    /{command.name}
                  </span>
                  {command.argumentHint ? (
                    <span className="min-w-0 truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
                      {command.argumentHint}
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-ui-aux text-[var(--color-text-tertiary)]">
                  {command.description}
                </span>
              </Button>
            ))}
          </div>
          {!isMobileComposer ? (
            <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-tertiary)]">
              <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Up/Down</kbd>
              <span>{t('chat.navigate')}</span>
              <kbd className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
              <span>{t('chat.select')}</span>
              <kbd className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
              <span>{t('chat.dismiss')}</span>
            </div>
          ) : null}
        </div></ComposerPopover>
      )}
    </>
  )

  return (
    <div
      data-testid="chat-input-shell"
      className={
        compact
          ? `bg-[var(--color-surface)] ${isMobileComposer ? 'px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2' : 'px-3 pb-3 pt-2'}`
          : `bg-[var(--color-surface)] ${isMobileComposer ? 'px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2' : isHeroComposer ? 'px-8 pb-5 pt-3' : 'px-6 pb-5 pt-3'}`
      }
    >
      <div
        className={
          compact
            ? 'mx-auto max-w-full'
            : isMobileComposer ? 'mx-0 max-w-none' : 'mx-auto w-full max-w-[760px]'
        }
      >
        {providerMissing ? (
          <ProviderGateCard />
        ) : (
          <>
            {composerAttachments.length > 0 && (
              <div className="mb-2">
                <AttachmentGallery attachments={composerAttachments} variant="composer" onRemove={removeAttachment} />
              </div>
            )}

            {isWorkspaceMissing && (
              <div
                data-testid="workspace-missing-notice"
                role="status"
                className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--color-error)]/20 bg-[var(--color-error)]/8 px-3 py-1.5 text-[11px] text-[var(--color-error)]"
              >
                <TriangleAlertIcon className="shrink-0" aria-hidden="true" size={14} />
                <HintTooltip content={activeSession?.workDir || undefined}><span className="min-w-0 truncate">
                  {activeSession?.workDir
                    ? t('chat.workspaceMissing', { dir: activeSession.workDir })
                    : t('chat.placeholderMissing')}
                </span></HintTooltip>
              </div>
            )}

            <ComposerBox
              panelRef={panelRef}
              testId="chat-input-panel"
              isDragActive={isDragActive}
              dragHandlers={dragHandlers}
              overlays={overlays}
              mobile={isMobileComposer}
              plusMenu={isMemberSession ? undefined : {
                open: plusMenuOpen,
                onToggle: () => setPlusMenuOpen((value) => !value),
                onClose: () => setPlusMenuOpen(false),
                onAddFiles: openAttachmentPicker,
                onSlashCommands: insertSlashCommand,
                addFilesLabel,
                slashCommandsLabel,
                toggleLabel: t('chat.composerTools'),
              }}
              textareaRef={textareaRef}
              textareaProps={{
                value: input,
                onChange: handleInputChange,
                onKeyDown: handleKeyDown,
                onCompositionStart: () => { composingRef.current = true },
                onCompositionEnd: () => { composingRef.current = false },
                onPaste: handlePaste,
                placeholder: composerPlaceholder,
                disabled: isWorkspaceMissing,
                'aria-label': t('chat.inputLabel'),
              }}
              action={{
                mode: isStopAction ? 'stop' : 'send',
                disabled: isStopAction ? false : !canSubmit,
                onClick: isStopAction ? () => stopGeneration(activeTabId!) : () => { void handleSubmit() },
                label: actionLabel,
                title: isStopAction ? t('chat.stopTitle') : actionLabel,
              }}
            />

            {!isMemberSession && (
              <ComposerControls
                testId="chat-input-controls"
                left={(
                  <>
                    {showLaunchControls ? (
                      <RepositoryLaunchControls
                        workDir={activeLaunchWorkDir}
                        onWorkDirChange={handleLaunchWorkDirChange}
                        branch={launchBranch}
                        onBranchChange={setLaunchBranch}
                        useWorktree={launchUseWorktree}
                        onUseWorktreeChange={setLaunchUseWorktree}
                        onLaunchReadyChange={setLaunchReady}
                        disabled={isActive || launchTransitioning}
                        placement="composer"
                        launchError={launchError}
                        onLaunchErrorDismiss={() => setLaunchError(null)}
                        noticeSlot={noticeSlot}
                      />
                    ) : (
                      <ProjectLabel
                        workDir={resolvedWorkDir}
                        repoName={gitInfo?.repoName || null}
                        branch={gitInfo?.branch || null}
                        sourceWorkDir={gitInfo?.worktree?.sourceWorkDir || null}
                        isWorktree={!!gitInfo?.worktree?.enabled}
                        worktreeSlug={gitInfo?.worktree?.slug || null}
                        worktreePath={gitInfo?.worktree?.path || gitInfo?.worktree?.plannedPath || null}
                      />
                    )}
                    <PermissionModeSelector
                      compact={useCompactControls}
                      value={permissionMode}
                      effectiveValue={effectivePermissionMode as typeof permissionMode | undefined}
                      onChange={(mode) => {
                        if (activeTabId) setSessionPermissionMode(activeTabId, mode)
                      }}
                    />
                  </>
                )}
                right={activeTabId ? (
                  <>
                    <ModelSelector runtimeKey={activeTabId} disabled={isActive} compact={useCompactControls} />
                    <ContextUsageIndicator
                      sessionId={activeTabId}
                      chatState={chatState}
                      messageCount={messageCount}
                      runtimeSelectionKey={runtimeSelectionKey}
                      fallbackModelLabel={runtimeModelLabel}
                      mobile={isMobileComposer}
                    />
                  </>
                ) : null}
              />
            )}
            <div ref={setNoticeSlot} className="empty:hidden [&>*]:mt-2" />
          </>
        )}

        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
      </div>
    </div>
  )
}
