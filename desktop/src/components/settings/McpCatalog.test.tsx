import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpCatalog } from './McpCatalog'
import { InvalidMcpCatalogError, loadMcpCatalog, parseMcpCatalog } from '../../lib/mcpCatalog'
import { openExternalUrl } from '../../lib/externalUrl'
import { useSettingsStore } from '../../stores/settingsStore'

vi.mock('../../lib/mcpCatalog', async (original) => ({ ...await original<typeof import('../../lib/mcpCatalog')>(), loadMcpCatalog: vi.fn() }))
vi.mock('../../lib/externalUrl', () => ({ openExternalUrl: vi.fn() }))

const catalog = parseMcpCatalog(JSON.stringify({ version: 1, servers: [
  { id: 'fake-files', name: 'Fake Files', description: 'Inspect files in a fake directory.', transport: 'stdio', command: 'fake-files-mcp', args: ['{env:TEST_PATH}'], env: [
    { name: 'TEST_PATH', source: 'user', description: 'Choose a fake folder.' },
    { name: 'TEST_SYSTEM', source: 'system' }, { name: 'TEST_OPTION', source: 'optional' },
  ], homepage: 'https://example.com/files', tags: ['files', 'local'], runtime: 'node' },
  { id: 'fake-web', name: 'Fake Web', description: 'Fetch an example web page.', transport: 'stdio', command: 'fake-web-mcp', homepage: 'https://example.com/web', tags: ['web'], runtime: 'uvx', version: '1.2.3', notes: 'An offline test fixture.' },
] }))

function renderCatalog(status: 'ready' | 'loading' | 'error' = 'ready') {
  return render(<McpCatalog installedNames={new Set(['fake-files'])} installedStatus={status} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsStore.setState({ locale: 'en' })
  vi.mocked(loadMcpCatalog).mockResolvedValue(catalog)
})
afterEach(cleanup)

describe('MCP catalog browse interactions', () => {
  it('shows required details and an honest installed-name badge without collecting secrets', async () => {
    renderCatalog()
    const files = await screen.findByRole('article', { name: 'Fake Files' })
    expect(within(files).getByText('Name already installed')).toBeInTheDocument()
    expect(within(files).getByText('fake-files-mcp {env:TEST_PATH}')).toBeInTheDocument()
    expect(within(files).getByText('Node.js')).toBeInTheDocument()
    expect(within(files).getByText('Choose a fake folder.')).toBeInTheDocument()
    expect(files).toHaveTextContent('Required · provided by you')
    expect(files).toHaveTextContent('Required · provided by the system')
    expect(files).toHaveTextContent('Optional')
    expect(files.querySelector('input')).toBeNull()
    const web = screen.getByRole('article', { name: 'Fake Web' })
    expect(web).toHaveTextContent('Package version: 1.2.3')
    expect(web).toHaveTextContent('None required')
    expect(web).toHaveTextContent('An offline test fixture.')
    expect(within(web).queryByText('Name already installed')).not.toBeInTheDocument()
    const homepage = within(files).getByRole('link', { name: 'Open Fake Files homepage' })
    expect(homepage).toHaveAttribute('rel', 'noopener noreferrer')
    fireEvent.click(homepage)
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/files')
  })

  it('combines search and tags, announces zero results, and clears both filters', async () => {
    renderCatalog()
    const search = await screen.findByRole('searchbox', { name: 'Search servers' })
    fireEvent.change(search, { target: { value: ' FAKE ' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by tag' }), { target: { value: 'web' } })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 servers')
    fireEvent.change(search, { target: { value: 'TEST_PATH' } })
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.getByText('No servers match your search and filters.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(search).toHaveValue('')
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it.each(['loading', 'error'] as const)('does not claim installed status while installed servers are %s', async (status) => {
    renderCatalog(status)
    await screen.findByRole('article', { name: 'Fake Files' })
    expect(screen.queryByText('Name already installed')).not.toBeInTheDocument()
    expect(screen.getAllByRole('status')).toHaveLength(2)
  })

  it('shows a loading state, then renders resolved entries', async () => {
    let resolve!: (value: typeof catalog) => void
    vi.mocked(loadMcpCatalog).mockReturnValue(new Promise((done) => { resolve = done }))
    renderCatalog()
    expect(screen.getByRole('status')).toHaveTextContent('Loading the MCP catalog')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    await act(async () => { resolve(catalog) })
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it.each([
    new Error('module unavailable'),
    new InvalidMcpCatalogError([{ path: 'servers.1.homepage', message: 'Homepage must use HTTP or HTTPS' }]),
  ])('fails closed and recovers on retry: %s', async (error) => {
    vi.mocked(loadMcpCatalog).mockRejectedValueOnce(error)
    renderCatalog()
    expect(await screen.findByRole('alert')).toHaveTextContent(error instanceof InvalidMcpCatalogError ? 'catalog is invalid' : 'could not be loaded')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    if (error instanceof InvalidMcpCatalogError) expect(screen.getByRole('alert')).toHaveTextContent('servers.1.homepage')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('article', { name: 'Fake Files' })
    expect(loadMcpCatalog).toHaveBeenCalledTimes(2)
  })

  it('ignores a failed load after unmount instead of replacing a subsequent visit', async () => {
    let reject!: (error: Error) => void
    vi.mocked(loadMcpCatalog).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    const first = renderCatalog()
    first.unmount()
    renderCatalog()
    await screen.findByRole('article', { name: 'Fake Files' })
    await act(async () => { reject(new Error('stale failure')) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })
})
