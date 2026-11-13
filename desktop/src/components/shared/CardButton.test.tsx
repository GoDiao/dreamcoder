import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CardButton } from './CardButton'

describe('CardButton', () => {
  afterEach(cleanup)

  it('renders a button that forwards props and keeps the shared classes next to its own', () => {
    const onClick = vi.fn()
    render(<CardButton data-testid="card" className="border-dashed p-4" onClick={onClick}>Card</CardButton>)

    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('type', 'button')
    expect(card).toHaveClass('border-dashed', 'p-4', 'rounded-lg', 'hover:bg-hover')
    fireEvent.click(card)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not fire when disabled', () => {
    const onClick = vi.fn()
    render(<CardButton disabled onClick={onClick}>Card</CardButton>)

    fireEvent.click(screen.getByRole('button', { name: 'Card' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
