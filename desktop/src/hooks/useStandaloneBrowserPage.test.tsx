import '@testing-library/jest-dom'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  placeBrowserGuest: vi.fn(),
  closeBrowser: vi.fn(),
  submitBrowserInput: vi.fn(),
  release: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../lib/browserGuests', () => ({
  placeBrowserGuest: mocks.placeBrowserGuest,
  closeBrowser: mocks.closeBrowser,
  submitBrowserInput: mocks.submitBrowserInput,
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { useStandaloneBrowserPage } from './useStandaloneBrowserPage'

type Props = { pageKey: string; resolve: () => Promise<{ filePath: string; rootDir: string }>; afterOpen?: () => Promise<unknown> }

function Page({ pageKey, resolve, afterOpen }: Props) {
  const stageRef = useStandaloneBrowserPage('tab', pageKey, resolve, afterOpen)
  return <div ref={stageRef} data-testid="stage" />
}

describe('useStandaloneBrowserPage', () => {
  beforeEach(() => {
    mocks.placeBrowserGuest.mockReturnValue(mocks.release)
    mocks.submitBrowserInput.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('places the guest, opens the resolved page, runs the follow-up after it and closes the guest on unmount', async () => {
    const afterOpen = vi.fn(async () => undefined)
    const view = render(<Page pageKey="a" resolve={async () => ({ filePath: '/p/index.html', rootDir: '/p' })} afterOpen={afterOpen} />)

    await waitFor(() => expect(afterOpen).toHaveBeenCalledOnce())
    expect(mocks.placeBrowserGuest).toHaveBeenCalledWith('tab', view.getByTestId('stage'), true)
    expect(mocks.submitBrowserInput).toHaveBeenCalledWith(null, 'tab', '/p/index.html', '/p')
    expect(mocks.submitBrowserInput.mock.invocationCallOrder[0]).toBeLessThan(afterOpen.mock.invocationCallOrder[0]!)

    view.unmount()
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(mocks.closeBrowser).toHaveBeenCalledWith('tab')
  })

  it('reports a failure to resolve the page and opens nothing', async () => {
    render(<Page pageKey="a" resolve={async () => { throw new Error('not found') }} />)

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('not found'))
    expect(mocks.submitBrowserInput).not.toHaveBeenCalled()
  })

  it('ignores a page that resolves after the key changed', async () => {
    let finishFirst!: (target: { filePath: string; rootDir: string }) => void
    const first = new Promise<{ filePath: string; rootDir: string }>((resolve) => { finishFirst = resolve })
    const view = render(<Page pageKey="a" resolve={() => first} />)
    view.rerender(<Page pageKey="b" resolve={async () => ({ filePath: '/b/index.html', rootDir: '/b' })} />)
    await waitFor(() => expect(mocks.submitBrowserInput).toHaveBeenCalledWith(null, 'tab', '/b/index.html', '/b'))

    finishFirst({ filePath: '/a/index.html', rootDir: '/a' })
    await Promise.resolve()

    expect(mocks.submitBrowserInput).toHaveBeenCalledTimes(1)
  })
})
