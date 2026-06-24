import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { ProjectContextChip } from './ProjectContextChip'

describe('ProjectContextChip', () => {
  it('shows only the source project label and worktree marker for isolated worktrees', () => {
    render(
      <ProjectContextChip
        workDir="/workspace/dreamcoder/.claude/worktrees/desktop-main-54a09f85"
        sourceWorkDir="/workspace/dreamcoder"
        repoName={null}
        branch="main"
        isWorktree
        worktreeSlug="desktop-main-54a09f85"
      />,
    )

    expect(screen.getByText('dreamcoder')).toBeInTheDocument()
    expect(screen.getByText('worktree')).toBeInTheDocument()
    expect(screen.queryByText('main')).not.toBeInTheDocument()
    expect(screen.queryByText('desktop-main-54a09f85')).not.toBeInTheDocument()
  })

  it('does not show worktree details for a normal checkout', () => {
    render(
      <ProjectContextChip
        workDir="/workspace/dreamcoder"
        repoName={null}
        branch="main"
      />,
    )

    expect(screen.getByText('dreamcoder')).toBeInTheDocument()
    expect(screen.queryByText('worktree')).not.toBeInTheDocument()
  })
})
