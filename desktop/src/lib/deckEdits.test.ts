import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reorderSlides: vi.fn(),
  writeSlide: vi.fn(),
  deleteSlide: vi.fn(),
  holdEdit: vi.fn(),
  releaseEdit: vi.fn(),
  takeDeckEdit: vi.fn(),
  refreshArtifactShell: vi.fn(),
  noteArtifactActivity: vi.fn(),
}))

vi.mock('../api/artifacts', () => ({ artifactsApi: { reorderSlides: mocks.reorderSlides, writeSlide: mocks.writeSlide, deleteSlide: mocks.deleteSlide, holdEdit: mocks.holdEdit, releaseEdit: mocks.releaseEdit } }))
vi.mock('./browserGuests', () => ({ takeDeckEdit: mocks.takeDeckEdit, refreshArtifactShell: mocks.refreshArtifactShell }))
vi.mock('../stores/artifactStore', () => ({ useArtifactStore: { getState: () => ({ noteArtifactActivity: mocks.noteArtifactActivity }) } }))

import { ApiError } from '../api/client'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'
import { applyDeckEdit, deleteDeckSlide, flushDeckEdits, isDeckConflict } from './deckEdits'

const target = { tabId: 't1', root: '/repo/dc_artifacts', name: 'talk', title: 'Talk', sessionId: 's1' }
const deckChanges = (sessionId = 's1') => (useWorkspaceChatContextStore.getState().referencesBySession[sessionId] ?? []).filter((reference) => reference.kind === 'artifact-edit')
const edit = (html: string, previous: string) => ({ id: 'agenda', html, previous })

beforeEach(() => {
  vi.clearAllMocks()
  useWorkspaceChatContextStore.setState(useWorkspaceChatContextStore.getInitialState(), true)
  mocks.reorderSlides.mockResolvedValue({ dir: '/repo/dc_artifacts/talk', files: ['artifact.json'] })
  mocks.writeSlide.mockResolvedValue({ dir: '/repo/dc_artifacts/talk', files: ['slides/agenda.html'] })
  mocks.deleteSlide.mockResolvedValue({ dir: '/repo/dc_artifacts/talk', files: ['artifact.json', 'slides/agenda.html'] })
  mocks.holdEdit.mockResolvedValue({ ok: true })
  mocks.releaseEdit.mockResolvedValue({ ok: true })
  mocks.refreshArtifactShell.mockResolvedValue(true)
  mocks.takeDeckEdit.mockResolvedValue(null)
})

describe('applyDeckEdit', () => {
  it('writes a new order of the slides and tells the app the artifact changed, leaving the deck as it already shows it', async () => {
    await applyDeckEdit(target, { type: 'order', slides: ['b', 'a'] })
    expect(mocks.reorderSlides).toHaveBeenCalledWith({ dir: '/repo/dc_artifacts', name: 'talk', slides: ['b', 'a'] })
    expect(mocks.noteArtifactActivity).toHaveBeenCalledOnce()
    expect(mocks.refreshArtifactShell).not.toHaveBeenCalled()
  })

  it('takes the edit from the deck and writes it with the text it was made from', async () => {
    mocks.takeDeckEdit.mockResolvedValueOnce(edit('<section>new</section>', '<section>old</section>'))
    await applyDeckEdit(target, { type: 'edit' })
    expect(mocks.takeDeckEdit).toHaveBeenCalledWith('t1')
    expect(mocks.writeSlide).toHaveBeenCalledWith({ dir: '/repo/dc_artifacts', name: 'talk', id: 'agenda', html: '<section>new</section>', previous: '<section>old</section>' })
    expect(mocks.noteArtifactActivity).toHaveBeenCalledOnce()
  })

  it('writes nothing when the deck holds no edit', async () => {
    await applyDeckEdit(target, { type: 'edit' })
    expect(mocks.writeSlide).not.toHaveBeenCalled()
    expect(mocks.noteArtifactActivity).not.toHaveBeenCalled()
  })

  it('reloads the deck from the files and passes the error on when a write fails or conflicts', async () => {
    mocks.reorderSlides.mockRejectedValue(new ApiError(409, { message: 'changed' }))
    const conflict = await applyDeckEdit(target, { type: 'order', slides: ['b', 'a'] }).catch((error: unknown) => error)
    expect(isDeckConflict(conflict)).toBe(true)
    expect(mocks.refreshArtifactShell).toHaveBeenCalledWith('t1')

    mocks.takeDeckEdit.mockResolvedValueOnce(edit('b', 'a'))
    mocks.writeSlide.mockRejectedValue(new Error('offline'))
    const failure = await applyDeckEdit(target, { type: 'edit' }).catch((error: unknown) => error)
    expect(isDeckConflict(failure)).toBe(false)
    expect(mocks.refreshArtifactShell).toHaveBeenCalledTimes(2)
    expect(mocks.noteArtifactActivity).not.toHaveBeenCalled()
  })

  it('writes every edit the deck holds on one message, in order, so an edit whose message was missed is not left behind', async () => {
    mocks.takeDeckEdit.mockResolvedValueOnce(edit('one', 'zero')).mockResolvedValueOnce(edit('two', 'one'))
    await applyDeckEdit(target, { type: 'edit' })
    expect(mocks.writeSlide.mock.calls.map((call) => call[0].previous)).toEqual(['zero', 'one'])
    expect(mocks.noteArtifactActivity).toHaveBeenCalledTimes(2)
    await applyDeckEdit(target, { type: 'edit' })
    expect(mocks.writeSlide).toHaveBeenCalledTimes(2)
  })

  it('writes the edits a deck still holds when asked to flush, as when the handler is registered again', async () => {
    mocks.takeDeckEdit.mockResolvedValueOnce(edit('one', 'zero'))
    await flushDeckEdits(target)
    expect(mocks.writeSlide).toHaveBeenCalledWith(expect.objectContaining({ html: 'one', previous: 'zero' }))
  })

  it('drops the edits built on a write that failed, so they do not fail again as conflicts', async () => {
    mocks.takeDeckEdit.mockResolvedValueOnce(edit('one', 'zero')).mockResolvedValueOnce(edit('two', 'one')).mockResolvedValueOnce(edit('three', 'two'))
    mocks.writeSlide.mockRejectedValueOnce(new Error('offline'))
    await expect(applyDeckEdit(target, { type: 'edit' })).rejects.toThrow('offline')
    expect(mocks.writeSlide).toHaveBeenCalledOnce()
    expect(mocks.takeDeckEdit).toHaveBeenCalledTimes(4)
    expect(mocks.refreshArtifactShell).toHaveBeenCalledWith('t1')
  })

  it('runs the writes of one tab one after another', async () => {
    let finishOrder = () => {}
    mocks.reorderSlides.mockImplementationOnce(() => new Promise((resolve) => { finishOrder = () => resolve({ dir: '/repo/dc_artifacts/talk', files: ['artifact.json'] }) }))
    mocks.takeDeckEdit.mockResolvedValueOnce(edit('one', 'zero'))
    const first = applyDeckEdit(target, { type: 'order', slides: ['b', 'a'] })
    const second = applyDeckEdit(target, { type: 'edit' })
    await vi.waitFor(() => expect(mocks.reorderSlides).toHaveBeenCalledOnce())
    expect(mocks.takeDeckEdit).not.toHaveBeenCalled()
    finishOrder()
    await Promise.all([first, second])
    expect(mocks.writeSlide).toHaveBeenCalledOnce()
  })

  it('keeps writing after an earlier write of the same tab failed', async () => {
    mocks.reorderSlides.mockRejectedValueOnce(new Error('offline'))
    await applyDeckEdit(target, { type: 'order', slides: ['b', 'a'] }).catch(() => undefined)
    await applyDeckEdit(target, { type: 'order', slides: ['a', 'b'] })
    expect(mocks.reorderSlides).toHaveBeenCalledTimes(2)
  })
})

describe('the chip that tells the agent about a slide change', () => {
  it('adds one chip for the deck to the session of the panel after a reorder, however often the user reorders', async () => {
    await applyDeckEdit(target, { type: 'order', slides: ['b', 'a'] })
    await applyDeckEdit(target, { type: 'order', slides: ['a', 'b'] })
    expect(deckChanges()).toMatchObject([{ path: '/repo/dc_artifacts/talk', name: 'Edited: Talk', artifactEdit: { files: ['artifact.json'], slides: true } }])
  })

  it('keeps one chip for the deck after a text edit and a deletion, with the files of both', async () => {
    mocks.takeDeckEdit.mockResolvedValueOnce(edit('one', 'zero'))
    await applyDeckEdit(target, { type: 'edit' })
    expect(deckChanges()).toMatchObject([{ artifactEdit: { files: ['slides/agenda.html'], slides: false } }])
    await deleteDeckSlide(target, 'agenda')
    expect(deckChanges()).toMatchObject([{ artifactEdit: { files: ['slides/agenda.html', 'artifact.json'], slides: true } }])
  })

  it('holds the deck while the user edits and releases it after the edit is written', async () => {
    mocks.takeDeckEdit.mockResolvedValueOnce(edit('one', 'zero'))
    await applyDeckEdit(target, { type: 'busy', on: true })
    expect(mocks.holdEdit).toHaveBeenCalledWith('/repo/dc_artifacts', 'talk', 't1')
    const writing = applyDeckEdit(target, { type: 'edit' })
    await applyDeckEdit(target, { type: 'busy', on: false })
    await writing
    await vi.waitFor(() => expect(mocks.releaseEdit).toHaveBeenCalledWith('/repo/dc_artifacts', 'talk', 't1'))
    expect(mocks.writeSlide.mock.invocationCallOrder[0]).toBeLessThan(mocks.releaseEdit.mock.invocationCallOrder[0]!)
  })

  it('holds the deck around a deletion', async () => {
    await deleteDeckSlide(target, 'agenda')
    await vi.waitFor(() => expect(mocks.releaseEdit).toHaveBeenCalled())
    expect(mocks.holdEdit.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteSlide.mock.invocationCallOrder[0]!)
    expect(mocks.deleteSlide.mock.invocationCallOrder[0]).toBeLessThan(mocks.releaseEdit.mock.invocationCallOrder[0]!)
  })

  it('adds no chip for a failed write or a panel without a session', async () => {
    mocks.reorderSlides.mockRejectedValueOnce(new ApiError(409, { message: 'changed' }))
    await applyDeckEdit(target, { type: 'order', slides: ['b', 'a'] }).catch(() => undefined)
    mocks.deleteSlide.mockRejectedValueOnce(new Error('offline'))
    await deleteDeckSlide(target, 'agenda').catch(() => undefined)
    expect(deckChanges()).toEqual([])

    await applyDeckEdit({ ...target, sessionId: null }, { type: 'order', slides: ['b', 'a'] })
    await deleteDeckSlide({ ...target, sessionId: null }, 'agenda')
    expect(useWorkspaceChatContextStore.getState().referencesBySession).toEqual({})
  })
})

describe('deleteDeckSlide', () => {
  it('deletes the slide, reloads the deck and tells the app the artifact changed', async () => {
    await deleteDeckSlide(target, 'agenda')
    expect(mocks.deleteSlide).toHaveBeenCalledWith('/repo/dc_artifacts', 'talk', 'agenda')
    expect(mocks.refreshArtifactShell).toHaveBeenCalledWith('t1')
    expect(mocks.noteArtifactActivity).toHaveBeenCalledOnce()
  })

  it('reloads the deck and passes the error on when the deletion fails', async () => {
    mocks.deleteSlide.mockRejectedValue(new ApiError(404, { message: 'gone' }))
    await expect(deleteDeckSlide(target, 'agenda')).rejects.toThrow('gone')
    expect(mocks.refreshArtifactShell).toHaveBeenCalledWith('t1')
    expect(mocks.noteArtifactActivity).not.toHaveBeenCalled()
  })
})
