import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const viewportMocks = vi.hoisted(() => ({
  isMobile: false,
  isDesktop: false,
}))

const apiMocks = vi.hoisted(() => ({
  getRepositoryContext: vi.fn(),
}))

vi.mock('../../hooks/useMobileViewport', () => ({
  useMobileViewport: () => viewportMocks.isMobile,
}))

vi.mock('../../lib/desktopRuntime', () => ({
  isDesktopRuntime: () => viewportMocks.isDesktop,
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getRepositoryContext: apiMocks.getRepositoryContext,
  },
}))

vi.mock('./DirectoryPicker', () => ({
  DirectoryPicker: ({ value }: { value: string }) => (
    <button type="button">Project {value}</button>
  ),
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => ({
    'common.loading': 'Loading',
    'repoLaunch.checkedOut': 'Checked out',
    'repoLaunch.checkedOutWarning': 'Branch is checked out elsewhere',
    'repoLaunch.currentBranch': 'Current branch',
    'repoLaunch.dirtyWarning': 'Dirty worktree',
    'repoLaunch.localBranch': 'Local branch',
    'repoLaunch.missingWorkdir': 'Missing working directory',
    'repoLaunch.noBranch': 'No branch',
    'repoLaunch.noBranchMatch': 'No matching branches',
    'repoLaunch.remoteBranch': 'Remote branch',
    'repoLaunch.searchBranch': 'Search branches',
    'repoLaunch.selectBranch': 'Select branch',
    'repoLaunch.newWorktree': 'Run in a new worktree',
    'repoLaunch.newWorktreeHint': 'Leaves your current checkout untouched',
    'repoLaunch.notice.branchTitle': 'Could not switch to the selected branch',
    'repoLaunch.notice.dirtyTitle': 'Uncommitted changes',
    'repoLaunch.notice.useWorktree': 'Use a new worktree',
    'repoLaunch.notice.pickBranch': 'Choose another branch',
    'repoLaunch.notice.retry': 'Retry',
    'tabs.close': 'Close',
  }[key] ?? key),
}))

import { RepositoryLaunchControls } from './RepositoryLaunchControls'

const okRepositoryContext = {
  state: 'ok' as const,
  root: '/repo',
  currentBranch: 'main',
  defaultBranch: 'main',
  dirty: false,
  branches: [
    {
      name: 'main',
      current: true,
      local: true,
      remote: false,
      checkedOut: false,
      remoteRef: null,
      worktreePath: null,
    },
    {
      name: 'feature/h5',
      current: false,
      local: true,
      remote: false,
      checkedOut: false,
      remoteRef: null,
      worktreePath: null,
    },
  ],
}

function renderControls(props: Partial<ComponentProps<typeof RepositoryLaunchControls>> = {}) {
  const defaultProps: ComponentProps<typeof RepositoryLaunchControls> = {
    workDir: '/repo',
    onWorkDirChange: vi.fn(),
    branch: 'main',
    onBranchChange: vi.fn(),
    useWorktree: false,
    onUseWorktreeChange: vi.fn(),
  }

  return render(<RepositoryLaunchControls {...defaultProps} {...props} />)
}

async function openBranchMenu() {
  const trigger = await screen.findByRole('button', { name: 'Select branch: main' })
  fireEvent.click(trigger)
  return trigger
}

describe('RepositoryLaunchControls', () => {
  beforeEach(() => {
    viewportMocks.isMobile = false
    viewportMocks.isDesktop = false
    apiMocks.getRepositoryContext.mockReset()
    apiMocks.getRepositoryContext.mockResolvedValue(okRepositoryContext)
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('keeps the desktop branch dropdown when not in mobile browser mode', async () => {
    renderControls()

    await openBranchMenu()

    const listbox = await screen.findByRole('listbox', { name: 'Select branch' })
    expect(listbox).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Select branch' })).not.toBeInTheDocument()
    expect(listbox.parentElement?.className).toContain('w-[390px]')
  })

  it('uses the flatter desktop bar when embedded in a composer', async () => {
    renderControls({ placement: 'composer' })

    const trigger = await screen.findByRole('button', { name: 'Select branch: main' })
    const bar = trigger.parentElement
    expect(bar).toHaveClass('bg-transparent')
    expect(bar).not.toHaveClass('rounded-b-xl', 'border-t')
    expect(bar).not.toHaveClass('bg-[var(--color-surface-container-low)]')
  })

  it('uses the full-width mobile bottom sheet in H5 mobile browser mode', async () => {
    viewportMocks.isMobile = true
    viewportMocks.isDesktop = false

    renderControls()

    await openBranchMenu()

    const dialog = await screen.findByRole('dialog', { name: 'Select branch' })
    expect(dialog).toHaveClass('inset-x-0')
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Select branch' })).toBeInTheDocument()
  })

  it('does not use the H5 mobile sheet inside the desktop app even on a narrow viewport', async () => {
    viewportMocks.isMobile = true
    viewportMocks.isDesktop = true

    renderControls()

    await openBranchMenu()

    const listbox = await screen.findByRole('listbox', { name: 'Select branch' })
    expect(listbox).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Select branch' })).not.toBeInTheDocument()
  })

  it('keeps keyboard branch selection working from the search field', async () => {
    const onBranchChange = vi.fn()
    renderControls({ onBranchChange })

    await openBranchMenu()

    const input = await screen.findByPlaceholderText('Search branches')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(onBranchChange).toHaveBeenCalledWith('feature/h5')
    })
  })

  it('keeps the worktree choice inside the branch menu instead of a separate control', async () => {
    const onUseWorktreeChange = vi.fn()
    const { rerender } = renderControls({ onUseWorktreeChange, placement: 'composer' })

    await screen.findByRole('button', { name: 'Select branch: main' })
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent))
      .toEqual(['Project /repo', 'Select branch: main'])

    await openBranchMenu()
    const toggle = await screen.findByRole('switch', { name: 'Run in a new worktree' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(onUseWorktreeChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('listbox', { name: 'Select branch' })).toBeInTheDocument()

    rerender(
      <RepositoryLaunchControls
        workDir="/repo"
        onWorkDirChange={vi.fn()}
        branch="main"
        onBranchChange={vi.fn()}
        useWorktree
        onUseWorktreeChange={onUseWorktreeChange}
        placement="composer"
      />,
    )
    expect(screen.getByRole('button', { name: 'Select branch: main · Run in a new worktree' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Run in a new worktree' })).toHaveAttribute('aria-checked', 'true')
  })

  it('offers an isolated worktree when the working tree is dirty', async () => {
    apiMocks.getRepositoryContext.mockResolvedValue({ ...okRepositoryContext, dirty: true })
    const onUseWorktreeChange = vi.fn()
    renderControls({ branch: 'feature/h5', onUseWorktreeChange, placement: 'composer' })

    const notice = await screen.findByTestId('repo-launch-notice-dirty')
    expect(notice).toHaveTextContent('Uncommitted changes')
    expect(notice).toHaveTextContent('Dirty worktree')

    fireEvent.click(screen.getByRole('button', { name: 'Use a new worktree' }))
    expect(onUseWorktreeChange).toHaveBeenCalledWith(true)
  })

  it('shows a launch branch failure in the notice slot and reopens the branch picker', async () => {
    const slot = document.createElement('div')
    document.body.appendChild(slot)
    const onLaunchErrorDismiss = vi.fn()
    renderControls({
      placement: 'composer',
      noticeSlot: slot,
      launchError: { kind: 'branch', message: 'Branch feature/gone no longer exists' },
      onLaunchErrorDismiss,
    })

    await screen.findByRole('button', { name: 'Select branch: main' })
    const notice = screen.getByTestId('repo-launch-notice-launch-branch')
    expect(slot).toContainElement(notice)
    expect(notice).toHaveTextContent('Could not switch to the selected branch')

    fireEvent.click(screen.getByRole('button', { name: 'Choose another branch' }))
    expect(await screen.findByRole('listbox', { name: 'Select branch' })).toBeInTheDocument()
    expect(apiMocks.getRepositoryContext).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('option', { name: /feature\/h5/ }))
    expect(onLaunchErrorDismiss).toHaveBeenCalled()
    slot.remove()
  })
})
