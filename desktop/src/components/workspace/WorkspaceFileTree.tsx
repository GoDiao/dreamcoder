import { useCallback, useEffect, useMemo, useRef } from 'react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import type { FileTreeBatchOperation } from '@pierre/trees'
import type { WorkspaceTreeResult } from '../../api/sessions'
import { makeTreeKey, useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { useUIStore } from '../../stores/uiStore'
import { themeColorScheme } from '../../theme/colorScheme'
import { useTranslation } from '../../i18n'
import { AnchoredActionMenu, type MenuEntry } from '../shared/ActionMenu'
import { isDesktopRuntime } from '../../lib/desktopRuntime'

const TREE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-fg-override: var(--foreground);
    --trees-fg-muted-override: var(--muted-foreground);
    --trees-selected-bg-override: var(--selected);
    --trees-hover-bg-override: var(--hover);
    --trees-border-color-override: var(--border);
    --trees-focus-ring-color-override: var(--ring);
    --trees-font-family-override: var(--font-body);
    --trees-font-size-override: 0.75rem;
    --trees-border-radius-override: 0.375rem;
  }
  [data-truncate-content='visible'] { overflow: hidden; text-overflow: ellipsis; }
  [data-truncate-marker] { display: none; }
`

export type TreeReveal = { path: string; isDirectory: boolean; nonce: number }

const EMPTY_TREE: Record<string, WorkspaceTreeResult | undefined> = {}

function treePathsFromLoadedDirectories(treeByPath: Record<string, WorkspaceTreeResult | undefined>) {
  const paths: string[] = []
  const visit = (directory: string) => {
    const tree = treeByPath[directory]
    if (tree?.state !== 'ok') return
    for (const entry of tree.entries) {
      paths.push(entry.isDirectory ? `${entry.path}/` : entry.path)
      if (entry.isDirectory) visit(entry.path)
    }
  }
  visit('')
  return paths
}

function pathUpdates(previous: readonly string[], next: readonly string[]): FileTreeBatchOperation[] {
  const before = new Set(previous)
  const after = new Set(next)
  const removed = previous.filter((path) => !after.has(path))
  const removedDirectories = removed.filter((path) => path.endsWith('/'))
  return [
    ...removed
      .filter((path) => !removedDirectories.some((directory) => directory !== path && path.startsWith(directory)))
      .map((path) => ({ type: 'remove' as const, path, recursive: true })),
    ...next.filter((path) => !before.has(path)).map((path) => ({ type: 'add' as const, path })),
  ]
}

export function WorkspaceFileTree({
  sessionId,
  label,
  filter,
  selectedPath,
  reveal,
  onOpenFile,
  getActions,
}: {
  sessionId: string
  label: string
  filter: string
  selectedPath: string | null
  reveal: TreeReveal | null
  onOpenFile: (path: string) => void
  getActions: (path: string, isDirectory: boolean) => MenuEntry[]
}) {
  const treeByPath = useWorkspacePanelStore((state) => state.treeBySessionPath[sessionId] ?? EMPTY_TREE)
  const theme = useUIStore((state) => state.theme)
  const addToast = useUIStore((state) => state.addToast)
  const t = useTranslation()
  const paths = useMemo(() => treePathsFromLoadedDirectories(treeByPath), [treeByPath])
  const pathsRef = useRef<readonly string[] | null>(null)
  const selectedRef = useRef(selectedPath)
  const onOpenFileRef = useRef(onOpenFile)
  const pendingRevealRef = useRef<TreeReveal | null>(null)
  const expandedRef = useRef(new Set<string>())

  useEffect(() => {
    selectedRef.current = selectedPath
    onOpenFileRef.current = onOpenFile
  })

  const { model } = useFileTree({
    paths: [],
    density: 'compact',
    initialExpansion: 'closed',
    icons: { set: 'complete', colored: true },
    search: false,
    fileTreeSearchMode: 'hide-non-matches',
    composition: { contextMenu: isDesktopRuntime() ? { triggerMode: 'right-click' } : { triggerMode: 'both', buttonVisibility: 'always' } },
    unsafeCSS: TREE_CSS,
    onSelectionChange: (selected) => {
      const path = selected.at(-1)
      if (!path || path.endsWith('/') || path === selectedRef.current) return
      onOpenFileRef.current(path)
    },
  })

  const loadDirectory = useCallback(async (directory: string) => {
    await useWorkspacePanelStore.getState().loadTree(sessionId, directory)
    const { treeBySessionPath, loading, errors } = useWorkspacePanelStore.getState()
    const key = makeTreeKey(sessionId, directory)
    const result = treeBySessionPath[sessionId]?.[directory]
    const error = errors.treeBySessionPath[key]
    const failed = Boolean(error) || (result !== undefined && result.state !== 'ok')
    if (!failed || loading.treeBySessionPath[key]) return
    addToast({
      type: 'error',
      message: t('workspace.folderLoadFailed', {
        path: directory,
        error: error || t(result?.state === 'missing' ? 'workspace.folderMissing' : 'workspace.loadError'),
      }),
    })
  }, [addToast, sessionId, t])

  const applyReveal = useCallback(() => {
    const pending = pendingRevealRef.current
    if (!pending) return
    const parts = pending.path.split('/').filter(Boolean)
    const directories = parts.slice(0, pending.isDirectory ? parts.length : -1).map((_, index) => `${parts.slice(0, index + 1).join('/')}/`)
    const items = directories.map((path) => model.getItem(path))
    if (items.some((item) => !item)) return
    for (const item of items) if (item && 'expand' in item) item.expand()
    pendingRevealRef.current = null
    if (parts.length === 0) return
    const target = pending.isDirectory ? `${pending.path}/` : pending.path
    model.scrollToPath(target)
    model.focusPath(target)
  }, [model])

  useEffect(() => {
    const previous = pathsRef.current
    if (previous === null) {
      model.resetPaths(paths)
    } else {
      const updates = pathUpdates(previous, paths)
      if (updates.length > 0) model.batch(updates)
    }
    pathsRef.current = paths
    applyReveal()
  }, [applyReveal, model, paths])

  useEffect(() => {
    if (!reveal) return
    pendingRevealRef.current = reveal
    const parts = reveal.path.split('/').filter(Boolean)
    const { treeBySessionPath, loading } = useWorkspacePanelStore.getState()
    const loaded = treeBySessionPath[sessionId] ?? EMPTY_TREE
    for (const [index] of parts.slice(0, -1).entries()) {
      const directory = parts.slice(0, index + 1).join('/')
      if (loaded[directory]?.state !== 'ok' && !loading.treeBySessionPath[makeTreeKey(sessionId, directory)]) void loadDirectory(directory)
    }
    applyReveal()
  }, [applyReveal, loadDirectory, reveal, sessionId])

  useEffect(() => {
    expandedRef.current = new Set()
    const loadExpanded = () => {
      const { treeBySessionPath, loading, errors } = useWorkspacePanelStore.getState()
      const loaded = treeBySessionPath[sessionId] ?? EMPTY_TREE
      const expanded = new Set<string>()
      for (const path of pathsRef.current ?? []) {
        if (!path.endsWith('/')) continue
        const item = model.getItem(path)
        if (!item || !('isExpanded' in item) || !item.isExpanded()) continue
        const directory = path.slice(0, -1)
        expanded.add(directory)
        const key = makeTreeKey(sessionId, directory)
        if (loading.treeBySessionPath[key] || loaded[directory]?.state === 'ok') continue
        const attempted = loaded[directory] !== undefined || Boolean(errors.treeBySessionPath[key])
        if (!attempted || !expandedRef.current.has(directory)) void loadDirectory(directory)
      }
      expandedRef.current = expanded
    }
    return model.subscribe(loadExpanded)
  }, [loadDirectory, model, sessionId])

  useEffect(() => {
    const value = filter.trim()
    model.setSearch(value ? value : null)
  }, [filter, model])

  useEffect(() => {
    if (!selectedPath || !paths.includes(selectedPath)) return
    for (const path of model.getSelectedPaths()) {
      if (path !== selectedPath) model.getItem(path)?.deselect()
    }
    const item = model.getItem(selectedPath)
    if (item && !item.isSelected()) item.select()
  }, [model, paths, selectedPath])

  return (
    <FileTree
      model={model}
      aria-label={label}
      data-testid="workspace-file-tree"
      className="min-h-0 flex-1 overflow-hidden"
      style={{ colorScheme: themeColorScheme(theme) }}
      renderContextMenu={(item, context) => (
        <AnchoredActionMenu
          actions={getActions(item.path.replace(/\/$/, ''), item.kind === 'directory')}
          anchor={context.anchorRect}
          label={item.name}
          onClose={() => context.close()}
          contentProps={{ 'data-file-tree-context-menu-root': 'true' }}
        />
      )}
    />
  )
}
