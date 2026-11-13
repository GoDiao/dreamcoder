import { useEffect, useRef } from 'react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { FILE_TREE_CSS } from '../shared/fileTreeCss'
import { useUIStore } from '../../stores/uiStore'
import { themeColorScheme } from '../../theme/colorScheme'
import type { FileTreeSortEntry } from '@pierre/trees'
import type { FileTreeNode } from '../../types/skill'

function sortRank(entry: FileTreeSortEntry, entryPath?: string) {
  if (entry.path === entryPath) return 0
  return entry.isDirectory ? 1 : 2
}

function treePaths(nodes: FileTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === 'directory' ? [`${node.path}/`, ...treePaths(node.children ?? [])] : [node.path],
  )
}

export function SkillFileTree({
  tree,
  entryPath,
  selectedPath,
  label,
  onSelect,
}: {
  tree: FileTreeNode[]
  entryPath?: string
  selectedPath: string
  label: string
  onSelect: (path: string) => void
}) {
  const theme = useUIStore((state) => state.theme)
  const onSelectRef = useRef(onSelect)

  useEffect(() => {
    onSelectRef.current = onSelect
  })

  const { model } = useFileTree({
    paths: treePaths(tree),
    density: 'compact',
    initialExpansion: 'open',
    initialSelectedPaths: [selectedPath],
    sort: (left, right) => sortRank(left, entryPath) - sortRank(right, entryPath) || left.basename.localeCompare(right.basename),
    icons: { set: 'complete', colored: true },
    search: false,
    unsafeCSS: FILE_TREE_CSS,
    onSelectionChange: (selected) => {
      const path = selected.at(-1)
      if (path && !path.endsWith('/')) onSelectRef.current(path)
    },
  })

  return (
    <FileTree
      model={model}
      aria-label={label}
      className="min-h-0 flex-1 overflow-hidden"
      style={{ colorScheme: themeColorScheme(theme) }}
    />
  )
}
