import { fireEvent, render, screen } from '@testing-library/react'
import { createRef, useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ComposerBox } from './ComposerShell'

function Harness({ onOuterEscape }: { onOuterEscape: () => void }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  return (
    <div onKeyDown={(event) => { if (event.key === 'Escape') onOuterEscape() }}>
      <ComposerBox
        panelRef={createRef<HTMLDivElement>()}
        testId="composer"
        textareaRef={createRef<HTMLTextAreaElement>()}
        textareaProps={{ 'aria-label': 'Message' }}
        action={{ mode: 'send', disabled: true, onClick: () => {}, label: 'Send' }}
        plusMenu={{
          open,
          onToggle: () => setOpen((value) => !value),
          onClose: () => setOpen(false),
          onAddFiles: () => setOpen(false),
          onSlashCommands: () => setOpen(false),
          addFilesLabel: 'Add files',
          slashCommandsLabel: 'Slash commands',
          toggleLabel: 'Add',
          menuRef,
        }}
      />
    </div>
  )
}

describe('ComposerBox plus menu', () => {
  it('focuses the first item, moves with arrows and closes on Escape back to the trigger', () => {
    const onOuterEscape = vi.fn()
    render(<Harness onOuterEscape={onOuterEscape} />)
    const trigger = screen.getByRole('button', { name: 'Add' })

    trigger.focus()
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Add files' }))

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Slash commands' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Add files' }))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Slash commands' }))

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(onOuterEscape).not.toHaveBeenCalled()
  })

  it('returns focus to the trigger after choosing an item', () => {
    render(<Harness onOuterEscape={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Add' })

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add files' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
