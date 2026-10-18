import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
}))

import { parseUnifiedDiff, WorkspaceDiffSurface } from './WorkspaceCodeSurface'

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,4 +10,5 @@ export function a() {',
  ' const one = 1',
  '-const two = 2',
  '+const two = 22',
  '+const three = 3',
  ' return one',
  '\\ No newline at end of file',
  '@@ -40 +41,2 @@',
  '-old tail',
  '+new tail',
  '+--- not a header',
  '',
].join('\n')

describe('parseUnifiedDiff', () => {
  it('computes old and new line numbers from hunk headers', () => {
    const lines = parseUnifiedDiff(DIFF)

    expect(lines.slice(0, 4).every((line) => line.kind === 'file-header')).toBe(true)
    expect(lines[4]).toMatchObject({ kind: 'hunk' })
    expect(lines[5]).toEqual({ kind: 'context', code: 'const one = 1', oldLine: 10, newLine: 10 })
    expect(lines[6]).toEqual({ kind: 'remove', code: 'const two = 2', oldLine: 11 })
    expect(lines[7]).toEqual({ kind: 'add', code: 'const two = 22', newLine: 11 })
    expect(lines[8]).toEqual({ kind: 'add', code: 'const three = 3', newLine: 12 })
    expect(lines[9]).toEqual({ kind: 'context', code: 'return one', oldLine: 12, newLine: 13 })
    expect(lines[10]).toMatchObject({ kind: 'meta' })
    expect(lines[11]).toMatchObject({ kind: 'hunk' })
    expect(lines[12]).toEqual({ kind: 'remove', code: 'old tail', oldLine: 40 })
    expect(lines[13]).toEqual({ kind: 'add', code: 'new tail', newLine: 41 })
    expect(lines[14]).toEqual({ kind: 'add', code: '--- not a header', newLine: 42 })
    expect(lines).toHaveLength(15)
  })

  it('still marks +/- lines when a diff has no hunk header', () => {
    expect(parseUnifiedDiff('diff --git a/x b/x\n-old\n+new').map((line) => line.kind)).toEqual([
      'file-header',
      'remove',
      'add',
    ])
  })
})

describe('WorkspaceDiffSurface', () => {
  it('shows real line numbers and allows comments on added and context lines only', () => {
    const onAddLineComment = vi.fn()
    render(
      <WorkspaceDiffSurface value={DIFF} path="src/a.ts" hideFileHeaders onAddLineComment={onAddLineComment} />,
    )

    expect(screen.queryByText('diff --git a/src/a.ts b/src/a.ts')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.commentLine:10' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.commentLine:12' })).toBeInTheDocument()
    const removed = document.querySelector('[data-diff-line-kind="remove"]')
    expect(removed?.querySelector('button')).toBeNull()
    expect(removed?.textContent).toContain('11')

    fireEvent.click(screen.getByRole('button', { name: 'workspace.commentLine:12' }))
    fireEvent.change(screen.getByPlaceholderText('workspace.commentPlaceholder'), { target: { value: 'rename' } })
    fireEvent.click(screen.getByRole('button', { name: 'workspace.addCommentToChat' }))

    expect(onAddLineComment).toHaveBeenCalledWith(12, 'rename', 'const three = 3')
  })

  it('opens the comment editor on the first added line when requested', () => {
    const { rerender } = render(
      <WorkspaceDiffSurface value={DIFF} path="src/a.ts" onAddLineComment={vi.fn()} commentRequest={0} />,
    )
    expect(screen.queryByPlaceholderText('workspace.commentPlaceholder')).not.toBeInTheDocument()

    rerender(<WorkspaceDiffSurface value={DIFF} path="src/a.ts" onAddLineComment={vi.fn()} commentRequest={1} />)
    expect(screen.getByText('workspace.commentLineTarget:11')).toBeInTheDocument()
  })
})
