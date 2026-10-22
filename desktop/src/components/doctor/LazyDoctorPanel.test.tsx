import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

describe('LazyDoctorPanel', () => {
  afterEach(() => {
    vi.doUnmock('./DoctorPanel')
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('renders the Doctor panel once its chunk has loaded', async () => {
    vi.doMock('./DoctorPanel', () => ({
      DoctorPanel: ({ compact }: { compact?: boolean }) => (
        <div data-testid="doctor-panel">{compact ? 'compact doctor' : 'doctor'}</div>
      ),
    }))
    const { LazyDoctorPanel } = await import('./LazyDoctorPanel')

    render(<LazyDoctorPanel compact />)

    expect(await screen.findByTestId('doctor-panel')).toHaveTextContent('compact doctor')
  })

  it('renders nothing, without breaking the surrounding error screen, when the chunk fails to load', async () => {
    vi.doMock('./DoctorPanel', () => {
      throw new Error('chunk failed to load')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { LazyDoctorPanel } = await import('./LazyDoctorPanel')

    const { container } = render(
      <main>
        <p>Something went wrong.</p>
        <LazyDoctorPanel compact />
      </main>,
    )

    // React reports the error it caught at the panel's own boundary.
    await waitFor(() => expect(consoleError).toHaveBeenCalled())
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
    expect(container.querySelector('main')?.children).toHaveLength(1)
  })
})
