import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi, type SessionTurnCheckpoint } from '../../api/sessions'
import { useSettingsStore } from '../../stores/settingsStore'
import { CurrentTurnChangeCard } from './CurrentTurnChangeCard'

const checkpoint = (filesChanged: string[], insertions = 418, deletions = 0): SessionTurnCheckpoint => ({
  target: { targetUserMessageId: 'user-1', userMessageIndex: 0, userMessageCount: 1 },
  code: { available: true, filesChanged, insertions, deletions },
})

const FILES = ['/repo/dc_artifacts/talk/slides/cover.html', '/repo/README.md', '/tmp/outside/notes.txt']

function renderCard(overrides: Partial<Parameters<typeof CurrentTurnChangeCard>[0]> = {}) {
  const onUndo = vi.fn()
  const view = render(
    <CurrentTurnChangeCard
      sessionId="s1"
      targetUserMessageId="user-1"
      checkpoint={checkpoint(FILES)}
      workDir="/repo"
      error={null}
      isUndoing={false}
      isLatest
      onUndo={onUndo}
      {...overrides}
    />,
  )
  return { onUndo, ...view }
}

const card = () => screen.getByRole('region', { name: 'Turn changed files' })
const summary = () => within(card()).getByRole('button', { name: /files changed/ })
const fileRows = () => within(card()).queryAllByRole('button', { name: /^(Show|Hide) diff for / })

function stubViewport(mobile: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: mobile, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
}

describe('CurrentTurnChangeCard', () => {
  beforeEach(() => {
    stubViewport(false)
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts collapsed to one line with the number of files and the lines added and removed', () => {
    renderCard()
    expect(summary()).toHaveTextContent('3 files changed')
    expect(summary()).toHaveTextContent('+418')
    expect(summary()).toHaveTextContent('−0')
    expect(summary()).toHaveAttribute('aria-expanded', 'false')
    expect(fileRows()).toHaveLength(0)
    expect(screen.queryByTestId('turn-change-files')).not.toBeInTheDocument()
  })

  it('lists the files when the line is clicked and hides them again on a second click', () => {
    renderCard()
    fireEvent.click(summary())
    expect(summary()).toHaveAttribute('aria-expanded', 'true')
    expect(fileRows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Show diff for dc_artifacts/talk/slides/cover.html',
      'Show diff for README.md',
      'Show diff for /tmp/outside/notes.txt',
    ])
    fireEvent.click(summary())
    expect(fileRows()).toHaveLength(0)
  })

  it('keeps the undo button usable while collapsed, without opening the list', () => {
    const { onUndo } = renderCard()
    fireEvent.click(within(card()).getByRole('button', { name: 'Undo current turn changes' }))
    expect(onUndo).toHaveBeenCalledOnce()
    expect(fileRows()).toHaveLength(0)
    expect(within(card()).getByRole('button', { name: 'Undo current turn changes' })).toHaveTextContent('Undo current turn')
  })

  it('shows the file name and, apart from it, the folder of each file', () => {
    renderCard()
    fireEvent.click(summary())
    const [nested, atRoot, outside] = fileRows()
    expect(within(nested!).getByText('cover.html')).toBeInTheDocument()
    expect(within(nested!).getByText('dc_artifacts/talk/slides')).toBeInTheDocument()
    expect(within(nested!).getByText('cover.html')).not.toBe(within(nested!).getByText('dc_artifacts/talk/slides'))
    expect(within(nested!).queryByText('dc_artifacts/talk/slides/cover.html')).not.toBeInTheDocument()
    expect(within(atRoot!).getByText('README.md').parentElement?.children).toHaveLength(1)
    expect(within(outside!).getByText('/tmp/outside')).toBeInTheDocument()
  })

  it('loads the diff of a file when its row is clicked', async () => {
    const getDiff = vi.spyOn(sessionsApi, 'getTurnCheckpointDiff').mockResolvedValue({ state: 'unavailable', error: 'No diff for this file.' } as never)
    renderCard()
    fireEvent.click(summary())
    fireEvent.click(fileRows()[1]!)
    expect(getDiff).toHaveBeenCalledWith('s1', 'user-1', '/repo/README.md', 0)
    await waitFor(() => expect(within(card()).getByText('No diff for this file.')).toBeInTheDocument())
    expect(within(card()).getByRole('button', { name: 'Hide diff for README.md' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows the changed lines of a file without repeating its name above them', async () => {
    const diff = ['--- a/README.md', '+++ b/README.md', '@@ -1 +1 @@', '-old title', '+new title', ''].join('\n')
    vi.spyOn(sessionsApi, 'getTurnCheckpointDiff').mockResolvedValue({ state: 'ok', diff } as never)
    renderCard()
    fireEvent.click(summary())
    fireEvent.click(fileRows()[1]!)
    await waitFor(() => expect(card().querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line-type="change-addition"]')).toBeTruthy())
    const surface = card().querySelector('diffs-container')!.shadowRoot!
    expect(surface.textContent).toContain('new title')
    expect(surface.querySelector('[data-diffs-header]')).toBeNull()
    expect(surface.textContent).not.toContain('README.md')
  })

  it('names the undo of an earlier turn differently and shows that it is running', () => {
    renderCard({ isLatest: false, isUndoing: true })
    const undo = within(card()).getByRole('button', { name: 'Rewind to before this turn' })
    expect(undo).toBeDisabled()
    expect(undo).toHaveTextContent('Undoing...')
  })

  it('shows why an undo failed even while collapsed', () => {
    renderCard({ error: 'The checkpoint is gone.' })
    expect(within(card()).getByText('The checkpoint is gone.')).toBeInTheDocument()
    expect(fileRows()).toHaveLength(0)
  })

  it('shrinks the undo button to its icon on a phone, keeping its name', () => {
    stubViewport(true)
    renderCard()
    const undo = within(card()).getByRole('button', { name: 'Undo current turn changes' })
    expect(undo).toHaveTextContent('')
    expect(undo).toHaveAttribute('title', 'Undo current turn')
    expect(summary()).toHaveTextContent('3 files changed')
  })

  it('uses the language of the app', () => {
    useSettingsStore.setState({ locale: 'zh' })
    renderCard()
    const region = screen.getByRole('region', { name: '轮次已更改文件' })
    expect(within(region).getByRole('button', { name: /3 个文件已更改/ })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: '撤销当前轮次变更' })).toHaveTextContent('撤销当前轮次')
  })
})
