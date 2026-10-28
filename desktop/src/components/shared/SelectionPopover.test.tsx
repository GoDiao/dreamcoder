import { useState } from 'react'
import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SelectionPopover } from './SelectionPopover'

afterEach(cleanup)

function Harness({ onAdd = () => {}, onClear = () => {} }: { onAdd?: () => void; onClear?: () => void }) {
  const [selection, setSelection] = useState<{ x: number; y: number } | null>({ x: 10, y: 10 })
  const quote = {
    selection,
    contains: (target: EventTarget | null) => target instanceof Element && target.closest('[data-testid="source"]') !== null,
    clear: () => { onClear(); setSelection(null) },
  }
  return <div onMouseUp={() => setSelection(null)}>
    <p data-testid="source">source text</p>
    <SelectionPopover label="Add to chat" quote={quote} onAdd={() => { if (selection) onAdd() }} />
  </div>
}

it('keeps the captured selection until the portal action is clicked', () => {
  const add = vi.fn()
  render(<Harness onAdd={add} />)
  const button = screen.getByRole('button', { name: 'Add to chat' })
  fireEvent.mouseDown(button)
  fireEvent.mouseUp(button)
  fireEvent.click(button)
  expect(add).toHaveBeenCalledOnce()
})

it('closes on Escape and clears the selection state', async () => {
  const clear = vi.fn()
  render(<Harness onClear={clear} />)
  fireEvent.keyDown(document.body, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Add to chat' })).toBeNull())
  expect(clear).toHaveBeenCalledOnce()
})

it('stays open when the pointer goes down inside the selection source', async () => {
  const clear = vi.fn()
  render(<Harness onClear={clear} />)
  await new Promise((resolve) => setTimeout(resolve, 0))
  fireEvent.pointerDown(screen.getByTestId('source'))
  expect(screen.getByRole('button', { name: 'Add to chat' })).toBeInTheDocument()
  expect(clear).not.toHaveBeenCalled()
})

it('closes when the pointer goes down outside the selection source', async () => {
  const clear = vi.fn()
  render(<Harness onClear={clear} />)
  await new Promise((resolve) => setTimeout(resolve, 0))
  fireEvent.pointerDown(document.body)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Add to chat' })).toBeNull())
  expect(clear).toHaveBeenCalledOnce()
})

it('opens above the selection', () => {
  render(<Harness />)
  expect(screen.getByRole('dialog', { name: 'Add to chat' })).toHaveAttribute('data-side', 'top')
})
