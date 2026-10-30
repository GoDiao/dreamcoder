import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef, useRef, useState } from 'react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { ComposerBox } from './ComposerShell'

function Harness({ onOuterEscape }: { onOuterEscape: () => void }) {
  const [open, setOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  return (
    <div onKeyDown={(event) => { if (event.key === 'Escape') onOuterEscape() }}>
      <ComposerBox
        panelRef={createRef<HTMLDivElement>()}
        testId="composer"
        textareaRef={textareaRef}
        textareaProps={{ 'aria-label': 'Message' }}
        action={{ mode: 'send', disabled: true, onClick: () => {}, label: 'Send' }}
        plusMenu={{
          open,
          onToggle: () => setOpen((value) => !value),
          onClose: () => setOpen(false),
          onAddFiles: () => setOpen(false),
          onSlashCommands: () => { setOpen(false); textareaRef.current?.focus() },
          addFilesLabel: 'Add files',
          slashCommandsLabel: 'Slash commands',
          toggleLabel: 'Add',
        }}
      />
    </div>
  )
}

describe('ComposerBox plus menu', () => {
  it('keeps typing focus in the message input', () => {
    render(<Harness onOuterEscape={() => {}} />)
    const textarea = screen.getByRole('textbox', { name: 'Message' })
    textarea.focus()
    expect(document.activeElement).toBe(textarea)
  })

  it('focuses the first item, moves with arrows and closes on Escape back to the trigger', async () => {
    const onOuterEscape = vi.fn()
    render(<Harness onOuterEscape={onOuterEscape} />)
    const trigger = screen.getByRole('button', { name: 'Add' })

    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Add files' })).toHaveFocus())

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Slash commands' })).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Add files' })).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Slash commands' })).toHaveFocus())

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(onOuterEscape).not.toHaveBeenCalled()
  })

  it('puts the add button right after the message in the tab order', () => {
    render(<Harness onOuterEscape={() => {}} />)
    const message = screen.getByRole('textbox', { name: 'Message' })
    const add = screen.getByRole('button', { name: 'Add' })
    const focusable = [...document.querySelectorAll<HTMLElement>('textarea, button:not([disabled])')]
    expect(focusable[focusable.indexOf(message) + 1]).toBe(add)
  })

  it('returns focus to the trigger after choosing an item', async () => {
    render(<Harness onOuterEscape={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Add' })

    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add files' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('preserves composer focus when choosing slash commands', async () => {
    render(<Harness onOuterEscape={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Add' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Slash commands' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
  })
})
