import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { Tooltip } from './Tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

describe('Tooltip', () => {
  it('announces the full description on keyboard focus and dismisses with Escape', async () => {
    render(<Tooltip content="/workspace/a-long-project-path"><button>Project</button></Tooltip>)
    const trigger = screen.getByRole('button', { name: 'Project' })
    act(() => trigger.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent('/workspace/a-long-project-path')
    expect(trigger).toHaveAccessibleDescription('/workspace/a-long-project-path')
    expect(trigger).not.toHaveAttribute('title')
    fireEvent.keyDown(trigger, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('leaves an unlabelled tooltip trigger usable without introducing an empty tooltip', () => {
    render(<Tooltip><button>Project</button></Tooltip>)
    expect(screen.getByRole('button', { name: 'Project' })).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('keeps the trigger mounted and focused when the description appears or goes away', () => {
    const { rerender } = render(<Tooltip><button>Mode</button></Tooltip>)
    const trigger = screen.getByRole('button', { name: 'Mode' })
    act(() => trigger.focus())
    rerender(<Tooltip content="Applies to the next turn"><button>Mode</button></Tooltip>)
    expect(screen.getByRole('button', { name: 'Mode' })).toBe(trigger)
    expect(trigger).toHaveFocus()
    rerender(<Tooltip><button>Mode</button></Tooltip>)
    expect(screen.getByRole('button', { name: 'Mode' })).toBe(trigger)
    expect(trigger).toHaveFocus()
  })

  it('toggles its description on a mounted trigger without a controlled and uncontrolled warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(<Tooltip><button>Mode</button></Tooltip>)
    const trigger = screen.getByRole('button', { name: 'Mode' })
    act(() => trigger.focus())
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    rerender(<Tooltip content="Applies to the next turn"><button>Mode</button></Tooltip>)
    act(() => { trigger.blur(); trigger.focus() })
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Applies to the next turn')
    rerender(<Tooltip><button>Mode</button></Tooltip>)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    warn.mockRestore()
    error.mockRestore()
  })

  it('stays closed when focus comes back to its trigger after a pointer interaction', async () => {
    render(<Tooltip content="Open project"><button>Open</button></Tooltip>)
    const trigger = screen.getByRole('button', { name: 'Open' })
    fireEvent.pointerDown(document.body)
    act(() => trigger.focus())
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => trigger.blur())
    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => trigger.focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Open project')
  })

  it('returns focus to a menu trigger only when the menu is closed from the keyboard', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button>Open</button></DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem>Finder</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>,
    )
    const trigger = screen.getByRole('button', { name: 'Open' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    fireEvent.keyDown(trigger, { key: 'Enter' })
    await screen.findByRole('menu')
    await waitFor(() => {
      fireEvent.pointerDown(document.body, { button: 0, pointerType: 'mouse' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    expect(trigger).not.toHaveFocus()
  })
})
