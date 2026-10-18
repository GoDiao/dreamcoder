import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { MemorySettings } from '../pages/MemorySettings'
import { useMemoryStore } from '../stores/memoryStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'

const { memoryApiMock } = vi.hoisted(() => ({
  memoryApiMock: {
    listProjects: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    saveFile: vi.fn(),
  },
}))

vi.mock('../api/memory', () => ({
  memoryApi: memoryApiMock,
}))

vi.mock('../components/markdown/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content, onLinkClick }: { content: string; onLinkClick?: (href: string) => boolean | void }) => {
    const match = content.match(/\[([^\]]+)\]\(([^)]+)\)/)
    const linkText = match?.[1]
    const linkHref = match?.[2]
    return (
      <div data-testid="markdown-preview">
        {content}
        {linkText && linkHref ? (
          <a
            href={linkHref}
            onClick={(event) => {
              if (onLinkClick?.(linkHref)) {
                event.preventDefault()
              }
            }}
          >
            {linkText}
          </a>
        ) : null}
      </div>
    )
  },
}))

async function showEditor() {
  fireEvent.click(await screen.findByRole('radio', { name: 'Edit' }))
  return screen.findByLabelText('Editor')
}

describe('MemorySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Active session',
          createdAt: '2026-05-01T00:00:00.000Z',
          modifiedAt: '2026-05-01T00:00:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/demo',
          workDir: '/workspace/demo',
          workDirExists: true,
        },
      ],
      activeSessionId: 'session-1',
    })
    useMemoryStore.setState({
      projects: [],
      files: [],
      selectedProjectId: null,
      selectedFile: null,
      draftContent: '',
      isLoadingProjects: false,
      isLoadingFiles: false,
      isLoadingFile: false,
      isSaving: false,
      error: null,
      lastSavedAt: null,
    })
    useUIStore.setState({ pendingMemoryPath: null, settingsTab: 'providers' })

    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        {
          id: '-workspace-demo',
          label: '/workspace/demo',
          memoryDir: '/tmp/claude/projects/-workspace-demo/memory',
          exists: true,
          fileCount: 1,
          isCurrent: true,
        },
      ],
    })
    memoryApiMock.listFiles.mockResolvedValue({
      files: [
        {
          path: 'MEMORY.md',
          name: 'MEMORY.md',
          title: 'MEMORY.md',
          bytes: 18,
          updatedAt: '2026-05-01T00:00:00.000Z',
          type: 'project',
          description: 'Project conventions.',
          isIndex: true,
        },
      ],
    })
    memoryApiMock.readFile.mockResolvedValue({
      file: {
        path: 'MEMORY.md',
        content: '# Project Memory\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 18,
      },
    })
    memoryApiMock.saveFile.mockResolvedValue({
      ok: true,
      file: {
        path: 'MEMORY.md',
        updatedAt: '2026-05-01T00:01:00.000Z',
        bytes: 28,
      },
    })
  })

  it('loads project-scoped markdown memory and saves manual edits', async () => {
    render(<MemorySettings />)

    expect(await screen.findByText('Project Memory')).toBeInTheDocument()
    expect(memoryApiMock.listProjects).toHaveBeenCalledWith('/workspace/demo')
    expect(await screen.findAllByText('workspace/demo')).not.toHaveLength(0)
    expect(await screen.findAllByText('MEMORY.md')).not.toHaveLength(0)
    expect(screen.queryByText('Project conventions.')).not.toBeInTheDocument()
    expect(screen.queryByText('Index')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('MEMORY.md or notes/project.md')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create memory file/i })).not.toBeInTheDocument()

    expect(await screen.findByTestId('markdown-preview')).toBeInTheDocument()
    const editor = await showEditor()
    expect(editor).toHaveValue('# Project Memory\n')

    fireEvent.change(editor, {
      target: { value: '# Project Memory\n\n- Prefer small diffs.\n' },
    })
    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Preview' }))
    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('Prefer small diffs')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(memoryApiMock.saveFile).toHaveBeenCalledWith({
        projectId: '-workspace-demo',
        path: 'MEMORY.md',
        content: '# Project Memory\n\n- Prefer small diffs.\n',
      })
    })
  })

  it('filters the unified resource tree by project path', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        {
          id: '-workspace-alpha',
          label: '/workspace/alpha',
          memoryDir: '/tmp/claude/projects/-workspace-alpha/memory',
          exists: true,
          fileCount: 1,
          isCurrent: true,
        },
        {
          id: '-workspace-beta',
          label: '/workspace/beta',
          memoryDir: '/tmp/claude/projects/-workspace-beta/memory',
          exists: true,
          fileCount: 2,
          isCurrent: false,
        },
      ],
    })

    render(<MemorySettings />)

    expect(await screen.findAllByText('workspace/alpha')).not.toHaveLength(0)
    expect(await screen.findByText('workspace/beta')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search projects or memory files...'), {
      target: { value: 'beta' },
    })

    expect(screen.queryByRole('button', { name: /workspace\/alpha/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('workspace/beta').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle workspace/beta' }))
    await waitFor(() => {
      expect(useMemoryStore.getState().selectedProjectId).toBe('-workspace-beta')
    })
  })

  it('renders nested memory files as a collapsible resource tree', async () => {
    memoryApiMock.listFiles.mockResolvedValue({
      files: [
        {
          path: 'MEMORY.md',
          name: 'MEMORY.md',
          title: 'MEMORY.md',
          bytes: 18,
          updatedAt: '2026-05-01T00:00:00.000Z',
          type: 'project',
          description: 'Project conventions.',
          isIndex: true,
        },
        {
          path: 'notes/manual.md',
          name: 'manual.md',
          title: 'Manual',
          bytes: 42,
          updatedAt: '2026-05-01T00:02:00.000Z',
          type: 'guidance',
          description: 'Operator workflow.',
          isIndex: false,
        },
        {
          path: 'notes/archive/old.md',
          name: 'old.md',
          title: 'Old note',
          bytes: 24,
          updatedAt: '2026-05-01T00:03:00.000Z',
          isIndex: false,
        },
      ],
    })
    memoryApiMock.readFile.mockImplementation((_projectId: string, path: string) => Promise.resolve({
      file: {
        path,
        content: path === 'notes/manual.md' ? '# Manual\n' : '# Project Memory\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 18,
      },
    }))

    render(<MemorySettings />)

    expect(await screen.findByRole('button', { name: 'Toggle notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle archive' })).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle notes' }))
    expect(screen.queryByText('Manual')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search projects or memory files...'), {
      target: { value: 'manual' },
    })

    expect(screen.getByText('Manual')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Manual'))

    await waitFor(() => {
      expect(memoryApiMock.readFile).toHaveBeenCalledWith('-workspace-demo', 'notes/manual.md')
    })
    expect(await showEditor()).toHaveValue('# Manual\n')
  })

  it('opens linked memory markdown files from the rendered preview', async () => {
    memoryApiMock.listFiles.mockResolvedValue({
      files: [
        {
          path: 'MEMORY.md',
          name: 'MEMORY.md',
          title: 'MEMORY.md',
          bytes: 48,
          updatedAt: '2026-05-01T00:00:00.000Z',
          type: 'project',
          description: 'Project conventions.',
          isIndex: true,
        },
        {
          path: 'notes/manual.md',
          name: 'manual.md',
          title: 'Manual',
          bytes: 24,
          updatedAt: '2026-05-01T00:02:00.000Z',
          type: 'guidance',
          isIndex: false,
        },
      ],
    })
    memoryApiMock.readFile.mockImplementation((_projectId: string, path: string) => Promise.resolve({
      file: {
        path,
        content: path === 'notes/manual.md'
          ? '# Manual\n'
          : '# Project Memory\n\n- [Manual](notes/manual.md)\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 48,
      },
    }))

    render(<MemorySettings />)

    fireEvent.click(await screen.findByRole('link', { name: 'Manual' }))

    await waitFor(() => {
      expect(memoryApiMock.readFile).toHaveBeenCalledWith('-workspace-demo', 'notes/manual.md')
    })
    expect(await showEditor()).toHaveValue('# Manual\n')
  })

  it('keeps frontmatter editable but removes it from the rendered preview', async () => {
    memoryApiMock.readFile.mockResolvedValue({
      file: {
        path: 'MEMORY.md',
        content: '---\ntype: project\n---\n\n# Project Memory\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 39,
      },
    })

    render(<MemorySettings />)

    expect(await screen.findByTestId('markdown-preview')).toHaveTextContent('Project Memory')
    expect(screen.getByTestId('markdown-preview')).not.toHaveTextContent('type: project')
    const editor = await showEditor()
    expect(editor).toHaveValue('---\ntype: project\n---\n\n# Project Memory\n')
    fireEvent.click(screen.getByRole('radio', { name: 'Preview' }))
    expect(screen.getByTestId('markdown-preview')).not.toHaveTextContent('type: project')
  })

  it('opens the exact memory file requested from chat', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        {
          id: '-workspace-demo',
          label: '/workspace/demo',
          memoryDir: '/tmp/claude/projects/-workspace-demo/memory',
          exists: true,
          fileCount: 0,
          isCurrent: true,
        },
        {
          id: '-workspace-other',
          label: '/workspace/other',
          memoryDir: '/tmp/claude/projects/-workspace-other/memory',
          exists: true,
          fileCount: 1,
          isCurrent: false,
        },
      ],
    })
    memoryApiMock.listFiles.mockImplementation((projectId: string) => Promise.resolve({
      files: projectId === '-workspace-other'
        ? [
            {
              path: 'preferences.md',
              name: 'preferences.md',
              title: 'preferences.md',
              bytes: 24,
              updatedAt: '2026-05-01T00:00:00.000Z',
              type: 'preference',
              isIndex: false,
            },
          ]
        : [],
    }))
    memoryApiMock.readFile.mockResolvedValue({
      file: {
        path: 'preferences.md',
        content: '# Preferences\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 24,
      },
    })
    useUIStore.setState({
      pendingMemoryPath: '/tmp/claude/projects/-workspace-other/memory/preferences.md',
    })

    render(<MemorySettings />)

    const editor = await showEditor()
    expect(editor).toHaveValue('# Preferences\n')
    expect(memoryApiMock.readFile).toHaveBeenCalledWith('-workspace-other', 'preferences.md')
    expect(useMemoryStore.getState().selectedProjectId).toBe('-workspace-other')
    expect(useUIStore.getState().pendingMemoryPath).toBeNull()
  })

  it('defaults to preview, switches to edit, and marks the edited file as unsaved', async () => {
    render(<MemorySettings />)

    expect(await screen.findByTestId('markdown-preview')).toBeInTheDocument()
    expect(screen.queryByLabelText('Editor')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Preview' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revert' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByTestId('memory-dirty-dot')).not.toBeInTheDocument()

    const editor = await showEditor()
    expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()
    fireEvent.change(editor, { target: { value: '# Changed\n' } })

    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    expect(screen.getByTestId('memory-dirty-dot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revert' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    expect(editor).toHaveValue('# Project Memory\n')
    expect(screen.queryByTestId('memory-dirty-dot')).not.toBeInTheDocument()
  })

  it('shows an empty project with no memory files', async () => {
    memoryApiMock.listFiles.mockResolvedValue({ files: [] })
    render(<MemorySettings />)

    expect(await screen.findByText('No memory files yet')).toBeInTheDocument()
  })
})
