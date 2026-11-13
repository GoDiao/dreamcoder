import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('../../i18n', () => {
  const translate = (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key
  return { useTranslation: () => translate }
})

import { LineCommentEditor, limitUnifiedDiff, parseUnifiedDiff, WorkspaceDiffSurface } from './WorkspaceCodeSurface'

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

describe('diff preview limit', () => {
  it('keeps hunk counts and real line offsets valid when clipping a patch', () => {
    const clipped = limitUnifiedDiff(DIFF, 9)
    expect(clipped).toContain('@@ -10,2 +10,3 @@ export function a() {')
    expect(clipped).toContain('+const three = 3')
    expect(clipped).not.toContain('return one')
    expect(parseUnifiedDiff(clipped).at(-1)).toMatchObject({ kind: 'add', newLine: 12 })
  })
})

describe('WorkspaceDiffSurface', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows real line numbers and allows comments on added and context lines only', async () => {
    const onAddLineComment = vi.fn()
    render(
      <WorkspaceDiffSurface value={DIFF} path="src/a.ts" hideFileHeaders onAddLineComment={onAddLineComment} />,
    )

    expect(screen.queryByText('diff --git a/src/a.ts b/src/a.ts')).not.toBeInTheDocument()
    const shadow = document.querySelector('diffs-container')!.shadowRoot!
    const code = within(shadow as unknown as HTMLElement)
    await waitFor(() => expect(code.getByRole('button', { name: 'workspace.commentLine:10' })).toBeTruthy())
    expect(code.getByRole('button', { name: 'workspace.commentLine:10' })).toBeInTheDocument()
    expect(code.getByRole('button', { name: 'workspace.commentLine:12' })).toBeInTheDocument()
    const removed = shadow.querySelector<HTMLElement>('[data-column-number][data-line-type="change-deletion"]')!
    expect(removed).not.toHaveAttribute('role')
    expect(removed).not.toHaveAttribute('tabindex')
    expect(removed.textContent).toContain('11')
    fireEvent.click(removed)
    fireEvent.keyDown(removed, { key: 'Enter' })
    expect(screen.queryByPlaceholderText('workspace.commentPlaceholder')).not.toBeInTheDocument()

    fireEvent.click(code.getByRole('button', { name: 'workspace.commentLine:12' }))
    fireEvent.change(screen.getByPlaceholderText('workspace.commentPlaceholder'), { target: { value: 'rename' } })
    fireEvent.click(screen.getByRole('button', { name: 'workspace.addCommentToChat' }))

    expect(onAddLineComment).toHaveBeenCalledWith(12, 'rename', 'const three = 3')
  })

  it('offers a comment button in the diff gutter for new lines only', async () => {
    render(<WorkspaceDiffSurface value={DIFF} path="src/a.ts" hideFileHeaders onAddLineComment={vi.fn()} />)
    const shadow = document.querySelector('diffs-container')!.shadowRoot!
    await waitFor(() => expect(shadow.querySelector('[data-line-type="change-addition"]')).toBeTruthy())
    const hover = (selector: string) => {
      const line = shadow.querySelector(selector)!
      line.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, composed: true }), { pointerType: 'mouse' }))
    }
    const button = () => document.querySelector<HTMLButtonElement>('[slot] button')!

    hover('[data-line-type="change-deletion"]')
    await waitFor(() => expect(button()).toHaveAttribute('data-hidden'))

    hover('[data-line-type="change-addition"]')
    await waitFor(() => expect(button()).not.toHaveAttribute('data-hidden'))
    expect(button()).toHaveAccessibleName('workspace.commentLine:11')
    fireEvent.click(button())
    expect(screen.getByText('workspace.commentLineTarget:11')).toBeInTheDocument()
  })

  it('keeps the rendered diff while a comment is typed', async () => {
    render(<WorkspaceDiffSurface value={DIFF} path="src/a.ts" onAddLineComment={vi.fn()} />)
    const shadow = document.querySelector('diffs-container')!.shadowRoot!
    const code = within(shadow as unknown as HTMLElement)
    await waitFor(() => expect(code.getByRole('button', { name: 'workspace.commentLine:12' })).toBeTruthy())
    fireEvent.click(code.getByRole('button', { name: 'workspace.commentLine:12' }))
    const line = await waitFor(() => code.getByRole('button', { name: 'workspace.commentLine:12' }))
    fireEvent.change(screen.getByPlaceholderText('workspace.commentPlaceholder'), { target: { value: 'r' } })
    fireEvent.change(screen.getByPlaceholderText('workspace.commentPlaceholder'), { target: { value: 're' } })
    expect(line.isConnected).toBe(true)
    expect(code.getByRole('button', { name: 'workspace.commentLine:12' })).toBe(line)
  })

  it.each([
    ['added lines', ['const two = 22', 'const three = 3'], { text: 'const two = 22\nconst three = 3', startLine: 11, endLine: 12 }],
    ['a removed line', ['const two = 2', 'const two = 22'], { text: 'const two = 2\nconst two = 22' }],
  ])('adds a selection across %s to the chat', async (_name, [first, last], expected) => {
    const onAddSelection = vi.fn()
    render(<WorkspaceDiffSurface value={DIFF} path="src/a.ts" onAddSelection={onAddSelection} />)
    const shadow = document.querySelector('diffs-container')!.shadowRoot!
    await waitFor(() => expect(shadow.querySelector('[data-line]')).toBeTruthy())
    const row = (text: string) => Array.from(shadow.querySelectorAll('[data-line]')).find((node) => node.textContent === text)!
    const start = row(first!)
    const end = row(last!)
    const getComposedRanges = () => [{ startContainer: start, startOffset: 0, endContainer: end, endOffset: end.childNodes.length }]
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, getComposedRanges, removeAllRanges: () => {} } as unknown as Selection)

    fireEvent.mouseDown(screen.getByTestId('workspace-code'), { button: 0 })
    fireEvent.mouseUp(screen.getByTestId('workspace-code'), { clientX: 10, clientY: 10 })
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.addSelectionToChat' }))

    expect(onAddSelection).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('shows clipped lines only after expanding and clips them again on collapse', async () => {
    const value = Array.from({ length: 30 }, (_, index) => `+line ${index + 1}`).join('\n')
    render(<WorkspaceDiffSurface value={value} path="src/a.ts" lineLimit={10} />)
    const shadowText = () => document.querySelector('diffs-container')!.shadowRoot!.textContent ?? ''
    await waitFor(() => expect(shadowText()).toContain('line 10'))
    expect(shadowText()).not.toContain('line 11')

    fireEvent.click(screen.getByRole('button', { name: 'workspace.showAllLoadedLines' }))
    await waitFor(() => expect(shadowText()).toContain('line 30'))

    fireEvent.click(screen.getByRole('button', { name: 'workspace.collapsePreview' }))
    await waitFor(() => expect(shadowText()).not.toContain('line 11'))
    expect(shadowText()).toContain('line 10')
  })
})

describe('LineCommentEditor focus', () => {
  it('focuses the comment text on open', () => {
    render(<LineCommentEditor lineNumber={1} draft="" onDraftChange={() => {}} onCancel={() => {}} onSubmit={() => {}} />)
    const textarea = screen.getByPlaceholderText('workspace.commentPlaceholder')
    expect(textarea).toHaveFocus()
  })

  it('submits with Enter, keeps Shift+Enter for new lines and cancels with Escape', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<LineCommentEditor lineNumber={3} draft="  Rename this  " onDraftChange={() => {}} onCancel={onCancel} onSubmit={onSubmit} />)
    const textarea = screen.getByPlaceholderText('workspace.commentPlaceholder')

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('Rename this')
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('closes when focus leaves it while empty, and keeps a written comment open', () => {
    const onCancel = vi.fn()
    const { rerender } = render(<><LineCommentEditor lineNumber={3} draft="" onDraftChange={() => {}} onCancel={onCancel} onSubmit={() => {}} /><button type="button">elsewhere</button></>)
    fireEvent.blur(screen.getByPlaceholderText('workspace.commentPlaceholder'), { relatedTarget: screen.getByRole('button', { name: 'elsewhere' }) })
    expect(onCancel).toHaveBeenCalledTimes(1)

    rerender(<><LineCommentEditor lineNumber={3} draft="keep me" onDraftChange={() => {}} onCancel={onCancel} onSubmit={() => {}} /><button type="button">elsewhere</button></>)
    fireEvent.blur(screen.getByPlaceholderText('workspace.commentPlaceholder'), { relatedTarget: screen.getByRole('button', { name: 'elsewhere' }) })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('leaves Enter and Escape to the input method while composing', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    render(<LineCommentEditor lineNumber={3} draft="ship it" onDraftChange={() => {}} onCancel={onCancel} onSubmit={onSubmit} />)
    const textarea = screen.getByPlaceholderText('workspace.commentPlaceholder')

    fireEvent.keyDown(textarea, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 })
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables sending an empty comment', () => {
    render(<LineCommentEditor lineNumber={3} draft="   " onDraftChange={() => {}} onCancel={() => {}} onSubmit={() => {}} />)
    expect(screen.getByRole('button', { name: 'workspace.addCommentToChat' })).toBeDisabled()
  })
})
