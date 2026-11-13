import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { FileTreeNode, SkillDetail as SkillDetailData } from '../../types/skill'

vi.mock('../markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content, variant }: { content: string; variant?: string }) => (
    <div data-testid="markdown-renderer" data-content={content} data-variant={variant} />
  ),
}))

vi.mock('./SkillFileTree', () => ({
  SkillFileTree: ({
    tree,
    entryPath,
    selectedPath,
    onSelect,
  }: {
    tree: FileTreeNode[]
    entryPath?: string
    selectedPath: string
    onSelect: (path: string) => void
  }) => (
    <div data-testid="skill-file-tree" data-entry={entryPath} data-selected={selectedPath}>
      {tree.map((node) => (
        <button key={node.path} type="button" onClick={() => onSelect(node.path)}>
          {node.name}
        </button>
      ))}
    </div>
  ),
}))

import { SkillDetail } from './SkillDetail'
import { useSkillStore } from '../../stores/skillStore'
import { useSettingsStore } from '../../stores/settingsStore'

const clearSelection = vi.fn(() => {
  useSkillStore.setState({ selectedSkill: null })
})

const SKILL: SkillDetailData = {
  meta: {
    name: 'skill-test',
    displayName: 'Skill Test',
    description: 'Skill description',
    source: 'plugin',
    pluginName: 'toolkit',
    version: '1.2.0',
    userInvocable: true,
    contentLength: 400,
    hasDirectory: true,
  },
  tree: [
    { name: 'SKILL.md', path: 'SKILL.md', type: 'file' },
    { name: 'run.ts', path: 'run.ts', type: 'file' },
  ],
  files: [
    {
      path: 'SKILL.md',
      kind: 'text',
      content: '---\nname: skill-test\n---\n# Skill Body',
      body: '# Skill Body',
      language: 'markdown',
      isEntry: true,
      frontmatter: {
        name: 'skill-test',
        description: 'Skill description',
        version: '1.2.0',
        'allowed-tools': ['Read', 'Edit'],
        model: 'sonnet',
      },
    },
    { path: 'run.ts', kind: 'text', content: 'console.log("run")', language: 'typescript' },
  ],
  skillRoot: '/tmp/skill-test',
}

function openContents() {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Contents · 2' }))
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  clearSelection.mockClear()
  useSkillStore.setState({
    selectedSkill: SKILL,
    selectedSkillReturnTab: 'skills',
    isDetailLoading: false,
    clearSelection,
  })
})

describe('SkillDetail', () => {
  it('shows each fact once on the overview', () => {
    render(<SkillDetail />)

    expect(screen.getByRole('heading', { name: 'Skill Test' })).toBeInTheDocument()
    expect(screen.getByText('Plugin · toolkit · v1.2.0')).toBeInTheDocument()
    expect(screen.getAllByText('Skill description')).toHaveLength(1)
    expect(screen.getByText('allowed tools')).toBeInTheDocument()
    expect(screen.getByText('Read, Edit')).toBeInTheDocument()
    expect(screen.getByText('sonnet')).toBeInTheDocument()
    expect(screen.getByText('/skill-test')).toBeInTheDocument()
    expect(screen.getByText('/tmp/skill-test')).toBeInTheDocument()
    expect(screen.getByText('~100 tokens')).toBeInTheDocument()
    expect(screen.queryByText('skill-test')).not.toBeInTheDocument()
  })

  it('previews the entry file as a document and switches to its source', () => {
    render(<SkillDetail />)
    openContents()

    expect(screen.getByTestId('skill-file-tree')).toHaveAttribute('data-entry', 'SKILL.md')
    const markdown = screen.getByTestId('markdown-renderer')
    expect(markdown).toHaveAttribute('data-variant', 'document')
    expect(markdown).toHaveAttribute('data-content', '# Skill Body')

    fireEvent.click(screen.getByRole('radio', { name: 'Source code' }))

    expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument()
    expect(screen.getByLabelText('markdown')).toHaveTextContent('name: skill-test')
  })

  it('shows a file picked in the tree as code', () => {
    render(<SkillDetail />)
    openContents()

    fireEvent.click(screen.getByRole('button', { name: 'run.ts' }))

    expect(screen.getByText('/run.ts')).toBeInTheDocument()
    expect(screen.getByLabelText('typescript')).toHaveTextContent('console.log("run")')
    expect(screen.queryByTestId('markdown-renderer')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Source code' })).not.toBeInTheDocument()
  })

  it('loads images from the skill folder and says when a file cannot be previewed', () => {
    useSkillStore.setState({
      selectedSkill: {
        ...SKILL,
        tree: [
          ...SKILL.tree,
          { name: 'logo.png', path: 'assets/logo.png', type: 'file' },
          { name: 'tool.bin', path: 'tool.bin', type: 'file' },
        ],
        files: [
          ...SKILL.files,
          { path: 'assets/logo.png', kind: 'image', content: '', language: 'image' },
          { path: 'tool.bin', kind: 'binary', content: '', language: 'binary' },
        ],
      },
    })
    render(<SkillDetail />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Contents · 4' }))

    fireEvent.click(screen.getByRole('button', { name: 'logo.png' }))
    expect(screen.getByRole('img', { name: 'assets/logo.png' }).getAttribute('src')).toMatch(
      /\/api\/filesystem\/file\?path=%2Ftmp%2Fskill-test%2Fassets%2Flogo\.png$/,
    )

    fireEvent.click(screen.getByRole('button', { name: 'tool.bin' }))
    expect(screen.getByText('Binary file preview is unavailable.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'assets/logo.png' })).not.toBeInTheDocument()
  })

  it('goes back to the skill list', () => {
    render(<SkillDetail />)

    fireEvent.click(screen.getByRole('button', { name: 'All skills' }))

    expect(clearSelection).toHaveBeenCalledTimes(1)
  })
})
