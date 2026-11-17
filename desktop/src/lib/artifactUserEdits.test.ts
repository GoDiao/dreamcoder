import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  holdEdit: vi.fn(),
  releaseEdit: vi.fn(),
  refreshArtifactShell: vi.fn(),
}))

vi.mock('../api/artifacts', () => ({ artifactsApi: { holdEdit: mocks.holdEdit, releaseEdit: mocks.releaseEdit } }))
vi.mock('./browserGuests', () => ({ refreshArtifactShell: mocks.refreshArtifactShell }))

import { ARTIFACT_HOLD_RENEW_MS, inArtifactTurn, markArtifactBusy, stopArtifactHold } from './artifactUserEdits'

const target = { tabId: 't1', root: '/repo/dc_artifacts', name: 'talk', title: 'Talk', sessionId: 's1' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.holdEdit.mockResolvedValue({ ok: true })
  mocks.releaseEdit.mockResolvedValue({ ok: true })
  mocks.refreshArtifactShell.mockResolvedValue(true)
})

afterEach(() => {
  stopArtifactHold('t1')
  vi.useRealTimers()
})

describe('holding an artifact while the user edits it', () => {
  it('holds the artifact for its tab and renews the hold until the user is done', async () => {
    markArtifactBusy(target, true)
    expect(mocks.holdEdit).toHaveBeenCalledWith('/repo/dc_artifacts', 'talk', 't1')
    vi.advanceTimersByTime(ARTIFACT_HOLD_RENEW_MS * 2)
    expect(mocks.holdEdit).toHaveBeenCalledTimes(3)
    markArtifactBusy(target, false)
    await vi.waitFor(() => expect(mocks.releaseEdit).toHaveBeenCalledWith('/repo/dc_artifacts', 'talk', 't1'))
    vi.advanceTimersByTime(ARTIFACT_HOLD_RENEW_MS * 2)
    expect(mocks.holdEdit).toHaveBeenCalledTimes(3)
  })

  it('stops renewing when the page goes away without saying it is done, so the hold runs out', () => {
    markArtifactBusy(target, true)
    stopArtifactHold('t1')
    vi.advanceTimersByTime(ARTIFACT_HOLD_RENEW_MS * 4)
    expect(mocks.holdEdit).toHaveBeenCalledOnce()
    expect(mocks.releaseEdit).not.toHaveBeenCalled()
  })

  it('releases after the writes queued before it, and not when the user started editing again meanwhile', async () => {
    let finishWrite = () => {}
    const writing = inArtifactTurn(target, () => new Promise<void>((resolve) => { finishWrite = resolve }))
    markArtifactBusy(target, false)
    markArtifactBusy(target, true)
    await vi.advanceTimersByTimeAsync(0)
    finishWrite()
    await writing
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.releaseEdit).not.toHaveBeenCalled()
    markArtifactBusy(target, false)
    await vi.waitFor(() => expect(mocks.releaseEdit).toHaveBeenCalledOnce())
  })

  it('does not reload the page when a release fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.releaseEdit.mockRejectedValueOnce(new Error('offline'))
    markArtifactBusy(target, false)
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(mocks.refreshArtifactShell).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
