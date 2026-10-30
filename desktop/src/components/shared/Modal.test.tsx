import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  it('portals the dialog to body so the scrim covers the full app shell', () => {
    const onClose = vi.fn()
    const { container } = render(
      <div data-testid="stacking-parent" className="relative z-10">
        <Modal open onClose={onClose} title="Provider">
          <span>Provider form</span>
        </Modal>
      </div>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Provider' })

    expect(container.contains(dialog)).toBe(false)
    expect(document.body.contains(dialog)).toBe(true)
  })

  it('keeps the outer focus ring off so only the focused field is highlighted', () => {
    render(
      <Modal open onClose={vi.fn()} title="Provider">
        <input aria-label="Name" />
      </Modal>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Provider' })
    expect(dialog.classList.contains('glass-panel')).toBe(true)
    expect(dialog.classList.contains('glass-panel-focus')).toBe(false)
  })

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose}>
        <span>Provider form</span>
      </Modal>,
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!
    await waitFor(() => {
      fireEvent.pointerDown(overlay, { pointerType: 'mouse', button: 0 })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
