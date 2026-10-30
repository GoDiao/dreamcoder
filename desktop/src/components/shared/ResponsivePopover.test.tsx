import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ResponsivePopover } from './ResponsivePopover'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen} title="Details" trigger={<button>Open</button>}>
      <button onClick={() => setOpen(false)}>Done</button>
    </ResponsivePopover>
  )
}

describe('ResponsivePopover on desktop', () => {
  it('returns focus to the trigger only when closed from the keyboard', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Details' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Details' })
    const done = screen.getByRole('button', { name: 'Done' })
    fireEvent.pointerDown(done, { button: 0, pointerType: 'mouse' })
    fireEvent.click(done)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).not.toHaveFocus()
  })
})
