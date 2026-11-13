import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { FileTreeSortEntry } from '@pierre/trees'
import type { FileTreeNode } from '../../types/skill'

type TreeOptions = {
  paths: string[]
  sort: (left: FileTreeSortEntry, right: FileTreeSortEntry) => number
  onSelectionChange: (paths: readonly string[]) => void
}

const captured: { options?: TreeOptions } = {}

vi.mock('@pierre/trees/react', () => ({
  useFileTree: (options: TreeOptions) => {
    captured.options = options
    return { model: {} }
  },
  FileTree: () => null,
}))

import { SkillFileTree } from './SkillFileTree'

const TREE: FileTreeNode[] = [
  {
    name: 'scripts',
    path: 'scripts',
    type: 'directory',
    children: [{ name: 'run.py', path: 'scripts/run.py', type: 'file' }],
  },
  { name: 'README.md', path: 'README.md', type: 'file' },
  { name: 'SKILL.md', path: 'SKILL.md', type: 'file' },
]

function entry(path: string): FileTreeSortEntry {
  const isDirectory = path.endsWith('/')
  const basename = path.replace(/\/$/, '').split('/').pop() ?? path
  return { path, basename, isDirectory } as FileTreeSortEntry
}

function renderTree(onSelect = vi.fn()) {
  render(<SkillFileTree tree={TREE} entryPath="SKILL.md" selectedPath="SKILL.md" label="Skill files" onSelect={onSelect} />)
  return { options: captured.options!, onSelect }
}

describe('SkillFileTree', () => {
  it('lists directories with a trailing slash followed by their files', () => {
    const { options } = renderTree()

    expect(options.paths).toEqual(['scripts/', 'scripts/run.py', 'README.md', 'SKILL.md'])
  })

  it('puts the entry file first, then directories, then other files', () => {
    const { options } = renderTree()

    const sorted = ['README.md', 'scripts/', 'SKILL.md'].map(entry).sort(options.sort).map((item) => item.path)

    expect(sorted).toEqual(['SKILL.md', 'scripts/', 'README.md'])
  })

  it('selects files and ignores directories', () => {
    const { options, onSelect } = renderTree()

    options.onSelectionChange(['scripts/'])
    expect(onSelect).not.toHaveBeenCalled()

    options.onSelectionChange(['scripts/run.py'])
    expect(onSelect).toHaveBeenCalledWith('scripts/run.py')
  })
})
