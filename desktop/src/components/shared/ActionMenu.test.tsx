import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { ActionMenu, RowActionMenu } from './ActionMenu'

function Harness({ disabled, onRename = () => undefined, onBatch = () => undefined }: { disabled?: boolean; onRename?: () => void; onBatch?: () => void }) {
  return (
    <RowActionMenu disabled={disabled} triggerLabel="Actions" actions={[
      { id: 'rename', label: 'Rename', onSelect: onRename, afterClose: true },
      { id: 'copy', label: 'Copy', onSelect: () => undefined },
      { id: 'batch', label: 'Batch manage', onSelect: onBatch },
    ]}>
      {(trigger) => <div><button>Open row</button>{trigger}</div>}
    </RowActionMenu>
  )
}

describe('RowActionMenu', () => {
  it('opens a context menu with Shift+F10 and restores the row focus on Escape', async () => {
    render(<Harness />)
    const row = screen.getByRole('button', { name: 'Open row' })
    act(() => row.focus())
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
    const rename = await screen.findByRole('menuitem', { name: 'Rename' })
    await waitFor(() => expect(rename).toHaveFocus())
    fireEvent.keyDown(rename, { key: 'Escape' })
    await waitFor(() => expect(row).toHaveFocus())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('returns focus before running an action selected from the dropdown', async () => {
    const focusAtAction = vi.fn()
    render(<Harness onRename={() => focusAtAction(document.activeElement)} />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const rename = await screen.findByRole('menuitem', { name: 'Rename' })
    await waitFor(() => expect(rename).toHaveFocus())
    fireEvent.keyDown(rename, { key: 'Enter' })
    await waitFor(() => expect(focusAtAction).toHaveBeenCalledExactlyOnceWith(trigger))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('provides the same actions for a pointer context menu', () => {
    render(<Harness />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open row' }), { clientX: 500, clientY: 300 })
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Rename', 'Copy', 'Batch manage'])
  })

  it.each(['dropdown', 'context'])('selects a multiword action from the %s menu', async (entry) => {
    const onBatch = vi.fn()
    render(<Harness onBatch={onBatch} />)
    if (entry === 'dropdown') {
      fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'ArrowDown' })
    } else {
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Open row' }))
    }
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Batch manage' }))
    expect(onBatch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps standalone operation labels accessible and selects them with the keyboard', async () => {
    const onSelect = vi.fn()
    render(<ActionMenu label="Project actions" trigger={<button>Project actions</button>} actions={[
      { id: 'existing', label: 'Use existing folder', onSelect },
    ]} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Project actions' }), { key: 'ArrowDown' })
    const item = await screen.findByRole('menuitem', { name: 'Use existing folder' })
    await waitFor(() => expect(item).toHaveFocus())
    fireEvent.keyDown(item, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('disables both menu entry points during batch selection', () => {
    render(<Harness disabled />)
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open row' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
