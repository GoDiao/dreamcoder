import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureCard, fixtureView, FIXTURE_BOARD } from '../components/kanban/kanbanFixture'
import { useKanbanStore } from './kanbanStore'

const kanbanApiMock = vi.hoisted(() => ({ view: vi.fn(), listBoards: vi.fn(), command: vi.fn(), createBoard: vi.fn(), history: vi.fn() }))
vi.mock('../api/kanban', () => ({ kanbanApi: kanbanApiMock }))

describe('kanbanStore', () => {
  beforeEach(() => {
    useKanbanStore.setState({ boards: null, views: {}, loadErrors: {}, snoozed: {} })
    localStorage.clear()
  })

  afterEach(() => vi.resetAllMocks())

  it('keeps the stored view untouched while the etag is unchanged and replaces it when it changes', async () => {
    const first = fixtureView([fixtureCard(1)])
    kanbanApiMock.view.mockResolvedValueOnce({ changed: true, view: first })
    await useKanbanStore.getState().refresh(FIXTURE_BOARD)
    expect(kanbanApiMock.view).toHaveBeenLastCalledWith(FIXTURE_BOARD, undefined)
    const views = useKanbanStore.getState().views

    kanbanApiMock.view.mockResolvedValueOnce({ changed: false, etag: first.etag })
    await useKanbanStore.getState().refresh(FIXTURE_BOARD)
    expect(kanbanApiMock.view).toHaveBeenLastCalledWith(FIXTURE_BOARD, 'etag-1')
    expect(useKanbanStore.getState().views).toBe(views)

    const second = fixtureView([fixtureCard(1), fixtureCard(2)], { etag: 'etag-2' })
    kanbanApiMock.view.mockResolvedValueOnce({ changed: true, view: second })
    await useKanbanStore.getState().refresh(FIXTURE_BOARD)
    expect(useKanbanStore.getState().views[FIXTURE_BOARD]).toBe(second)
  })

  it('records a failed poll and clears it on the next success', async () => {
    kanbanApiMock.view.mockRejectedValueOnce(new Error('offline'))
    await useKanbanStore.getState().refresh(FIXTURE_BOARD)
    expect(useKanbanStore.getState().loadErrors[FIXTURE_BOARD]).toBe('offline')

    kanbanApiMock.view.mockResolvedValueOnce({ changed: true, view: fixtureView([]) })
    await useKanbanStore.getState().refresh(FIXTURE_BOARD)
    expect(useKanbanStore.getState().loadErrors[FIXTURE_BOARD]).toBeUndefined()
  })

  it('keeps a newer view when an older poll answers after it', async () => {
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: fixtureView([fixtureCard(1)]) } })
    let answer: (value: unknown) => void = () => undefined
    kanbanApiMock.view.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
    const polling = useKanbanStore.getState().refresh(FIXTURE_BOARD)

    const newer = fixtureView([fixtureCard(1), fixtureCard(2)], { etag: 'etag-3' })
    kanbanApiMock.command.mockResolvedValueOnce({ view: newer, warnings: [] })
    await useKanbanStore.getState().execute(FIXTURE_BOARD, { type: 'start', card: 2 })
    answer({ changed: true, view: fixtureView([fixtureCard(1)], { etag: 'etag-2' }) })
    await polling

    expect(useKanbanStore.getState().views[FIXTURE_BOARD]).toBe(newer)
  })

  it('keeps a newer view when an older command answers after it', async () => {
    const newer = fixtureView([fixtureCard(1), fixtureCard(2)], { version: 6 })
    useKanbanStore.setState({ views: { [FIXTURE_BOARD]: newer } })
    kanbanApiMock.command.mockResolvedValueOnce({ view: fixtureView([fixtureCard(1)], { version: 5 }), warnings: [] })

    await useKanbanStore.getState().execute(FIXTURE_BOARD, { type: 'start', card: 1 })

    expect(useKanbanStore.getState().views[FIXTURE_BOARD]).toBe(newer)
  })

  it('forgets a snoozed item once it leaves the inbox, so it is shown again when it comes back', async () => {
    const review = { kind: 'review' as const, card: 3 }
    useKanbanStore.getState().setSnoozed(FIXTURE_BOARD, 'review:3', true)
    kanbanApiMock.command.mockResolvedValueOnce({ view: fixtureView([], { inbox: [review] }), warnings: [] })
    await useKanbanStore.getState().execute(FIXTURE_BOARD, { type: 'start', card: 1 })
    expect(useKanbanStore.getState().snoozed[FIXTURE_BOARD]).toEqual(['review:3'])

    kanbanApiMock.command.mockResolvedValueOnce({ view: fixtureView([], { inbox: [] }), warnings: [] })
    await useKanbanStore.getState().execute(FIXTURE_BOARD, { type: 'start', card: 1 })
    expect(useKanbanStore.getState().snoozed[FIXTURE_BOARD]).toEqual([])
    expect(JSON.parse(localStorage.getItem('dreamcoder-kanban-snoozed')!)).toEqual({ [FIXTURE_BOARD]: [] })
  })

  it('remembers snoozed inbox items across reloads', () => {
    useKanbanStore.getState().setSnoozed(FIXTURE_BOARD, 'review:3', true)
    expect(JSON.parse(localStorage.getItem('dreamcoder-kanban-snoozed')!)).toEqual({ [FIXTURE_BOARD]: ['review:3'] })

    useKanbanStore.getState().setSnoozed(FIXTURE_BOARD, 'review:3', false)
    expect(useKanbanStore.getState().snoozed[FIXTURE_BOARD]).toEqual([])
  })
})
