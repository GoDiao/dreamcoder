import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  putThumbnail: vi.fn(),
  contentsId: vi.fn(),
}))

vi.mock('../lib/shell', () => ({ captureBrowserThumbnail: mocks.capture }))
vi.mock('../api/artifacts', () => ({ artifactsApi: { putThumbnail: mocks.putThumbnail } }))
vi.mock('../lib/browserGuests', () => ({ getBrowserGuestContentsId: mocks.contentsId }))

import { useBrowserStore } from '../stores/browserStore'
import { resetCapturedThumbnails, useArtifactThumbnail } from './useArtifactThumbnail'

const settle = () => act(async () => {
  await vi.advanceTimersByTimeAsync(1_100)
})

describe('useArtifactThumbnail', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCapturedThumbnails()
    mocks.capture.mockResolvedValue('jpeg-base64')
    mocks.putThumbnail.mockResolvedValue({ ok: true })
    mocks.contentsId.mockReturnValue(31)
    useBrowserStore.setState({ pageByTab: { t1: { ready: true, loading: false, canGoBack: false, canGoForward: false } } })
  })

  afterEach(() => {
    vi.useRealTimers()
    useBrowserStore.setState(useBrowserStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('captures the page a moment after it finished loading and saves it under the artifact id', async () => {
    renderHook(() => useArtifactThumbnail('t1', { id: 'id-1', mtimeMs: 10 }))
    expect(mocks.capture).not.toHaveBeenCalled()

    await settle()

    expect(mocks.capture).toHaveBeenCalledWith({ webContentsId: 31 })
    expect(mocks.putThumbnail).toHaveBeenCalledWith('id-1', 10, 'jpeg-base64')
  })

  it('waits while the page is still loading or not ready', async () => {
    useBrowserStore.setState({ pageByTab: { t1: { ready: true, loading: true, canGoBack: false, canGoForward: false } } })
    renderHook(() => useArtifactThumbnail('t1', { id: 'id-1', mtimeMs: 10 }))
    await settle()
    expect(mocks.capture).not.toHaveBeenCalled()

    act(() => {
      useBrowserStore.setState({ pageByTab: { t1: { ready: true, loading: false, canGoBack: false, canGoForward: false } } })
    })
    await settle()
    expect(mocks.capture).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a page that is not an artifact or has no guest', async () => {
    renderHook(() => useArtifactThumbnail('t1', undefined))
    mocks.contentsId.mockReturnValue(null)
    renderHook(() => useArtifactThumbnail('t1', { id: 'id-2', mtimeMs: 1 }))
    await settle()
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('captures an artifact version once and again after the files changed', async () => {
    const { rerender } = renderHook(({ mtimeMs }) => useArtifactThumbnail('t1', { id: 'id-1', mtimeMs }), { initialProps: { mtimeMs: 10 } })
    await settle()
    rerender({ mtimeMs: 10 })
    await settle()
    expect(mocks.capture).toHaveBeenCalledTimes(1)

    rerender({ mtimeMs: 20 })
    await settle()
    expect(mocks.capture).toHaveBeenCalledTimes(2)
    expect(mocks.putThumbnail).toHaveBeenLastCalledWith('id-1', 20, 'jpeg-base64')
  })

  it('does not capture twice when another view of the same artifact version opens', async () => {
    renderHook(() => useArtifactThumbnail('t1', { id: 'id-1', mtimeMs: 10 }))
    await settle()
    renderHook(() => useArtifactThumbnail('t1', { id: 'id-1', mtimeMs: 10 }))
    await settle()
    expect(mocks.capture).toHaveBeenCalledTimes(1)
  })

  it('logs a failure and tries again the next time the page loads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.capture.mockRejectedValueOnce(new Error('nothing to capture'))
    const first = renderHook(() => useArtifactThumbnail('t1', { id: 'id-1', mtimeMs: 10 }))
    await settle()
    expect(warn).toHaveBeenCalled()
    first.unmount()

    renderHook(() => useArtifactThumbnail('t1', { id: 'id-1', mtimeMs: 10 }))
    await settle()
    expect(mocks.putThumbnail).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('cancels a pending capture when the view goes away', async () => {
    const { unmount } = renderHook(() => useArtifactThumbnail('t1', { id: 'id-1', mtimeMs: 10 }))
    unmount()
    await settle()
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
