import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { WorkspaceTreeNavigation } from './WorkspaceTreeNavigation'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../shared/ui/collapsible'
import { Button } from '../shared/ui/button'

function Tree({ loaded = true }: { loaded?: boolean }) {
  const [open, setOpen] = useState(false)
  return <WorkspaceTreeNavigation label="Files">
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild><Button role="treeitem" data-tree-path="src" data-parent-path="" data-directory="true">src</Button></CollapsibleTrigger>
      <CollapsibleContent role="group">{loaded && <Button role="treeitem" data-tree-path="src/a.ts" data-parent-path="src" aria-expanded="false">a.ts</Button>}</CollapsibleContent>
    </Collapsible>
    <Button role="treeitem" data-tree-path="readme.md" data-parent-path="" aria-expanded="false">readme.md</Button>
  </WorkspaceTreeNavigation>
}

afterEach(cleanup)

describe('workspace tree keyboard navigation', () => {
  it('uses a single tab stop and moves through visible children with arrow keys and Home/End', () => {
    render(<Tree />)
    const folder = screen.getByRole('treeitem', { name: 'src' })
    const file = screen.getByRole('treeitem', { name: 'readme.md' })
    expect(folder).toHaveAttribute('tabindex', '0')
    expect(file).toHaveAttribute('tabindex', '-1')
    act(() => folder.focus())
    fireEvent.keyDown(folder, { key: 'ArrowRight' })
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(folder, { key: 'ArrowRight' })
    const child = screen.getByRole('treeitem', { name: 'a.ts' })
    expect(child).toHaveFocus()
    fireEvent.keyDown(child, { key: 'ArrowDown' })
    expect(file).toHaveFocus()
    fireEvent.keyDown(file, { key: 'ArrowUp' })
    expect(child).toHaveFocus()
    fireEvent.keyDown(child, { key: 'ArrowLeft' })
    expect(folder).toHaveFocus()
    fireEvent.keyDown(folder, { key: 'ArrowLeft' })
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(folder, { key: 'End' })
    expect(file).toHaveFocus()
    fireEvent.keyDown(file, { key: 'Home' })
    expect(folder).toHaveFocus()
  })

  it('enters a directory after async children arrive without stealing focus after the user moves away', () => {
    const { rerender } = render(<Tree loaded={false} />)
    const folder = screen.getByRole('treeitem', { name: 'src' })
    act(() => folder.focus())
    fireEvent.keyDown(folder, { key: 'ArrowRight' })
    fireEvent.keyDown(folder, { key: 'ArrowRight' })
    rerender(<Tree loaded />)
    expect(screen.getByRole('treeitem', { name: 'a.ts' })).toHaveFocus()
    rerender(<Tree loaded={false} />)
    act(() => folder.focus())
    fireEvent.keyDown(folder, { key: 'ArrowRight' })
    fireEvent.keyDown(folder, { key: 'End' })
    rerender(<Tree loaded />)
    expect(screen.getByRole('treeitem', { name: 'readme.md' })).toHaveFocus()
  })
})
