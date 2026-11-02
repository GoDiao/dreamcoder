import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ mac: false }))

vi.mock('../../lib/windowChrome', () => ({ isMacOverlayTitlebar: () => mocks.mac }))

import { ViewerHeader } from './ViewerHeader'

describe('ViewerHeader', () => {
  beforeEach(() => {
    mocks.mac = false
  })

  afterEach(() => {
    cleanup()
    mocks.mac = false
  })

  it('shows the title and the actions, and goes back from the button', () => {
    const onBack = vi.fn()
    render(<ViewerHeader title="Launch page" onBack={onBack}><button type="button">Export</button></ViewerHeader>)
    expect(screen.getByRole('heading', { name: 'Launch page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('is a window drag region as tall as the title bar on macOS', () => {
    mocks.mac = true
    render(<ViewerHeader title="Launch page" onBack={vi.fn()}>{null}</ViewerHeader>)
    const header = screen.getByTestId('viewer-header')
    expect(header).toHaveClass('window-drag-region')
    expect(header).toHaveStyle({ height: 'var(--titlebar-height)' })
    expect(header).not.toHaveClass('h-11')
  })

  it('is a window drag region with a fixed height class elsewhere', () => {
    render(<ViewerHeader title="Launch page" onBack={vi.fn()}>{null}</ViewerHeader>)
    const header = screen.getByTestId('viewer-header')
    expect(header).toHaveClass('window-drag-region', 'h-11')
  })
})
