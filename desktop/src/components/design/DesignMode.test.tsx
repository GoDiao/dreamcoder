import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  templates: vi.fn(),
  systemCatalog: vi.fn(),
  preview: vi.fn(),
  startDesignSession: vi.fn(),
  placeBrowserGuest: vi.fn(),
  release: vi.fn(),
  closeBrowser: vi.fn(),
  submitBrowserInput: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../../api/design', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/design')>()),
  designApi: { templates: mocks.templates, systemCatalog: mocks.systemCatalog, preview: mocks.preview },
}))
vi.mock('../../lib/startDesignSession', () => ({ startDesignSession: mocks.startDesignSession }))
vi.mock('../../lib/browserGuests', () => ({
  placeBrowserGuest: mocks.placeBrowserGuest,
  closeBrowser: mocks.closeBrowser,
  submitBrowserInput: mocks.submitBrowserInput,
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { useArtifactViewStore } from '../../stores/artifactViewStore'
import { useDesignSystemStore } from '../../stores/designSystemStore'
import { useDesignTemplateStore } from '../../stores/designTemplateStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { DesignSystem, DesignTemplate } from '../../types/design'
import { DESIGN_PREVIEW_TAB } from './DesignTemplatePreview'
import { DesignMode } from './DesignMode'

const template = (id: string, category: DesignTemplate['category'], platform: DesignTemplate['platform'] = 'desktop'): DesignTemplate => ({
  id,
  category,
  platform,
  scenario: null,
  entry: 'index.html',
  acceptsDesignSystem: true,
  title: { en: `Title ${id}`, zh: `标题 ${id}` },
  description: { en: `About ${id}`, zh: `关于 ${id}` },
  tags: [`tag-${id}`],
})

const designSystem = (id: string, origin: DesignSystem['origin'], category: string, zhName = ''): DesignSystem => ({
  id,
  name: { en: `System ${id}`, zh: zhName },
  category,
  description: { en: `Look of ${id}`, zh: '' },
  origin,
  swatches: ['#ffffff', '#f5f5f5', '#111111', '#ff5701'],
  license: { id: 'Apache-2.0', file: null, copyright: 'c' },
  author: 'a',
})

const session = (id: string, projectRoot: string | null, workDir: string | null, workDirExists = true) => ({
  id,
  title: id,
  createdAt: '',
  modifiedAt: '',
  messageCount: 1,
  projectPath: '',
  projectRoot,
  workDir,
  workDirExists,
})

describe('DesignMode', () => {
  beforeEach(() => {
    mocks.placeBrowserGuest.mockReturnValue(mocks.release)
    mocks.submitBrowserInput.mockResolvedValue(undefined)
    mocks.startDesignSession.mockResolvedValue('s-new')
    mocks.templates.mockResolvedValue({
      version: 1,
      templates: [template('saas', 'web'), template('app', 'prototype', 'mobile'), template('blog', 'web', null)],
    })
    mocks.systemCatalog.mockResolvedValue({
      version: 1,
      systems: [
        designSystem('paper', 'starter', 'Editorial', '纸感'),
        designSystem('fin-one', 'converted', 'Fintech'),
        designSystem('fin-two', 'converted', 'Fintech'),
        designSystem('dev-one', 'converted', 'Developer Tools'),
      ],
    })
    mocks.preview.mockResolvedValue({ rootDir: '/app/design-templates/saas', filePath: '/app/design-templates/saas/index.html' })
    useSettingsStore.setState({ locale: 'en' })
    useSessionStore.setState({
      sessions: [
        session('s1', '/work/alpha', '/work/alpha/wt'),
        session('s2', null, '/work/beta'),
        session('s3', '/work/alpha', '/work/alpha'),
        session('s4', '/work/gone', '/work/gone', false),
      ],
    })
    useArtifactViewStore.setState({ designing: true })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    useDesignTemplateStore.setState(useDesignTemplateStore.getInitialState(), true)
    useDesignSystemStore.setState(useDesignSystemStore.getInitialState(), true)
    useArtifactViewStore.setState(useArtifactViewStore.getInitialState(), true)
    useSessionStore.setState(useSessionStore.getInitialState(), true)
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  })

  it('makes the title row a window drag region', async () => {
    render(<DesignMode />)

    expect(await screen.findByText('Title saas')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Design' }).parentElement).toHaveClass('window-drag-region')
  })

  it('lists the templates with their type and platform, and a card to start from scratch', async () => {
    render(<DesignMode />)

    expect(await screen.findByText('Title saas')).toBeInTheDocument()
    expect(screen.getAllByTestId('design-template-card')).toHaveLength(3)
    expect(screen.getByText('Web · Desktop')).toBeInTheDocument()
    expect(screen.getByText('Prototype · Mobile')).toBeInTheDocument()
    expect(within(screen.getAllByTestId('design-template-card')[2]!).getByText('Web')).toBeInTheDocument()
    expect(screen.getByTestId('design-scratch')).toBeInTheDocument()
  })

  it('shows the titles in the language of the app', async () => {
    useSettingsStore.setState({ locale: 'zh' })
    render(<DesignMode />)

    expect(await screen.findByText('标题 saas')).toBeInTheDocument()
    expect(screen.getByText('关于 saas')).toBeInTheDocument()
    expect(screen.getByText('网页 · 桌面')).toBeInTheDocument()
  })

  it('filters by template type', async () => {
    render(<DesignMode />)
    await screen.findByText('Title saas')

    expect(screen.queryByRole('radio', { name: 'Slides' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Prototype' }))

    expect(screen.getAllByTestId('design-template-card')).toHaveLength(1)
    expect(screen.getByText('Title app')).toBeInTheDocument()
    expect(screen.queryByText('Title saas')).not.toBeInTheDocument()
  })

  it('searches the templates and keeps the two entry cards', async () => {
    render(<DesignMode />)
    await screen.findByText('Title saas')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), { target: { value: 'tag-app' } })

    expect(screen.getAllByTestId('design-template-card')).toHaveLength(1)
    expect(screen.getByText('Title app')).toBeInTheDocument()
    expect(screen.getByTestId('design-scratch')).toBeInTheDocument()
    expect(screen.getByTestId('design-clone')).toBeInTheDocument()
  })

  it('says no template matches, apart from an empty category, and recovers when the search is cleared', async () => {
    render(<DesignMode />)
    await screen.findByText('Title saas')
    const box = screen.getByRole('searchbox', { name: 'Search templates' })

    fireEvent.change(box, { target: { value: 'nothing like this' } })
    expect(screen.queryByTestId('design-template-card')).not.toBeInTheDocument()
    expect(screen.getByText('No templates match.')).toBeInTheDocument()
    expect(screen.queryByText('No templates in this category.')).not.toBeInTheDocument()
    expect(screen.getByTestId('design-scratch')).toBeInTheDocument()

    fireEvent.change(box, { target: { value: '' } })
    expect(screen.getAllByTestId('design-template-card')).toHaveLength(3)
    expect(screen.queryByText('No templates match.')).not.toBeInTheDocument()
  })

  it('applies the search together with the template type and keeps the search across tabs', async () => {
    render(<DesignMode />)
    await screen.findByText('Title saas')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), { target: { value: 'title' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Web' }))
    expect(screen.getAllByTestId('design-template-card')).toHaveLength(2)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), { target: { value: 'app' } })
    expect(screen.queryByTestId('design-template-card')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Design systems' }))
    expect(screen.queryByRole('searchbox', { name: 'Search templates' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Templates' }))
    expect(screen.getByRole('searchbox', { name: 'Search templates' })).toHaveValue('app')
  })

  it('searches the Chinese title and the label of the search box follows the language', async () => {
    useSettingsStore.setState({ locale: 'zh' })
    render(<DesignMode />)
    await screen.findByText('标题 saas')

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索模板' }), { target: { value: '标题 blog' } })
    expect(screen.getAllByTestId('design-template-card')).toHaveLength(1)
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索模板' }), { target: { value: 'zzz' } })
    expect(screen.getByText('没有匹配的模板。')).toBeInTheDocument()
  })

  it('starts a chat that begins design mode in the first project when nothing else was chosen', async () => {
    render(<DesignMode />)
    await screen.findByText('Title saas')

    fireEvent.click(screen.getByTestId('design-scratch'))

    await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/alpha', { template: undefined, designSystemId: undefined }))
    await waitFor(() => expect(useArtifactViewStore.getState().designing).toBe(false))
  })

  it('starts in the project picked from the project list', async () => {
    render(<DesignMode />)
    await screen.findByText('Title saas')

    const trigger = screen.getByRole('combobox', { name: 'Project' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'beta' }))
    fireEvent.click(screen.getByTestId('design-scratch'))

    await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/beta', { template: undefined, designSystemId: undefined }))
  })

  it('falls back to the first project when the chosen one is no longer listed', async () => {
    render(<DesignMode />)
    await screen.findByText('Title saas')
    const trigger = screen.getByRole('combobox', { name: 'Project' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'beta' }))
    expect(trigger).toHaveTextContent('beta')

    act(() => {
      useSessionStore.setState({ sessions: [session('s1', '/work/alpha', '/work/alpha/wt')] })
    })
    expect(trigger).toHaveTextContent('alpha')
    fireEvent.click(screen.getByTestId('design-scratch'))

    await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/alpha', { template: undefined, designSystemId: undefined }))
  })

  it('creates the artifact from the chosen template in the project', async () => {
    render(<DesignMode />)
    const card = (await screen.findByText('Title saas')).closest('[data-testid="design-template-card"]') as HTMLElement

    fireEvent.click(within(card).getByRole('button', { name: 'Use this template' }))

    await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/alpha', { template: { id: 'saas', title: 'Title saas' }, designSystemId: undefined }))
  })

  it('tells the user when starting failed and stays on the page', async () => {
    mocks.startDesignSession.mockRejectedValue(new Error('disk full'))
    render(<DesignMode />)
    await screen.findByText('Title saas')

    fireEvent.click(screen.getByTestId('design-scratch'))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('disk full'))
    expect(useArtifactViewStore.getState().designing).toBe(true)
  })

  it('previews a template in the page and uses it from the preview', async () => {
    render(<DesignMode />)
    const card = (await screen.findByText('Title saas')).closest('[data-testid="design-template-card"]') as HTMLElement

    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }))

    expect(await screen.findByTestId('design-template-preview')).toBeInTheDocument()
    await waitFor(() => expect(mocks.submitBrowserInput).toHaveBeenCalledWith(
      null,
      DESIGN_PREVIEW_TAB,
      '/app/design-templates/saas/index.html',
      '/app/design-templates/saas',
    ))
    fireEvent.click(screen.getByRole('button', { name: 'Use this template' }))
    await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/alpha', { template: { id: 'saas', title: 'Title saas' }, designSystemId: undefined }))

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  })

  it('returns from the preview to the library and releases the page', async () => {
    render(<DesignMode />)
    const card = (await screen.findByText('Title saas')).closest('[data-testid="design-template-card"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }))
    await screen.findByTestId('design-template-preview')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByTestId('design-mode')).toBeInTheDocument()
    expect(mocks.closeBrowser).toHaveBeenCalledWith(DESIGN_PREVIEW_TAB)
    expect(mocks.release).toHaveBeenCalled()
  })

  it('asks the user to open a project first when no chat has a folder', async () => {
    useSessionStore.setState({ sessions: [session('s4', '/work/gone', '/work/gone', false)] })
    render(<DesignMode />)

    expect(screen.getByText('Open a project in a chat first, then come back to design in it.')).toBeInTheDocument()
    expect(screen.queryByTestId('design-scratch')).not.toBeInTheDocument()
  })

  it('reports a catalog that could not be loaded', async () => {
    mocks.templates.mockRejectedValue(new Error('offline'))
    render(<DesignMode />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the templates: offline')
    expect(screen.getByTestId('design-scratch')).toBeInTheDocument()
  })

  it('goes back to the Artifacts list', async () => {
    render(<DesignMode />)
    await screen.findByText('Title saas')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(useArtifactViewStore.getState().designing).toBe(false)
  })

  describe('design systems', () => {
    const openSystems = async () => {
      render(<DesignMode />)
      await screen.findByText('Title saas')
      fireEvent.click(screen.getByRole('radio', { name: 'Design systems' }))
      await screen.findAllByTestId('design-system-card')
    }

    it('lists the systems with colors, category and source, and says converted ones are not official', async () => {
      await openSystems()

      expect(screen.getAllByTestId('design-system-card')).toHaveLength(4)
      expect(screen.queryByTestId('design-template-card')).not.toBeInTheDocument()
      expect(screen.getByText('Editorial · DreamCoder starter')).toBeInTheDocument()
      expect(screen.getAllByText('Fintech · Converted style reference')).toHaveLength(2)
      expect(screen.getAllByTestId('system-swatches')[0]!.children).toHaveLength(4)
      expect(screen.getByText(/not official brand assets/)).toBeInTheDocument()
      expect(screen.queryByRole('radio', { name: 'Slides' })).not.toBeInTheDocument()
    })

    it('filters by category and by search text', async () => {
      await openSystems()

      fireEvent.change(screen.getByRole('searchbox', { name: 'Search design systems' }), { target: { value: 'dev-one' } })
      expect(screen.getAllByTestId('design-system-card')).toHaveLength(1)
      expect(screen.getByText('System dev-one')).toBeInTheDocument()

      fireEvent.change(screen.getByRole('searchbox', { name: 'Search design systems' }), { target: { value: 'nothing like this' } })
      expect(screen.getByText('No design systems match.')).toBeInTheDocument()
    })

    it('shows the Chinese name when there is one and falls back to English when there is not', async () => {
      useSettingsStore.setState({ locale: 'zh' })
      render(<DesignMode />)
      await screen.findByText('标题 saas')
      fireEvent.click(screen.getByRole('radio', { name: '设计系统' }))

      expect(await screen.findByText('纸感')).toBeInTheDocument()
      expect(screen.getByText('System fin-one')).toBeInTheDocument()
      expect(screen.getByText('转换来的设计系统是参照知名品牌写成的风格参考，不是官方资产。')).toBeInTheDocument()
    })

    it('shows the loading failure of the library', async () => {
      mocks.systemCatalog.mockRejectedValue(new Error('offline'))
      render(<DesignMode />)
      await screen.findByText('Title saas')
      fireEvent.click(screen.getByRole('radio', { name: 'Design systems' }))

      expect(await screen.findByText('Could not load the design systems: offline')).toBeInTheDocument()
    })

    it('keeps the chosen system when going back to the templates and passes it with the template', async () => {
      await openSystems()
      const card = screen.getByText('System paper').closest('[data-testid="design-system-card"]') as HTMLElement
      fireEvent.click(within(card).getByRole('button', { name: 'Use this system' }))
      expect(within(card).getByRole('button', { name: 'Selected' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('design-system-chip')).toHaveTextContent('Design system: System paper')

      fireEvent.click(screen.getByRole('radio', { name: 'Templates' }))
      const templateCard = (await screen.findByText('Title saas')).closest('[data-testid="design-template-card"]') as HTMLElement
      fireEvent.click(within(templateCard).getByRole('button', { name: 'Use this template' }))

      await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/alpha', { template: { id: 'saas', title: 'Title saas' }, designSystemId: 'paper' }))
    })

    it('passes the chosen system when starting from scratch and from the preview', async () => {
      await openSystems()
      fireEvent.click(within(screen.getByText('System fin-one').closest('[data-testid="design-system-card"]') as HTMLElement).getByRole('button', { name: 'Use this system' }))
      fireEvent.click(screen.getByRole('radio', { name: 'Templates' }))

      fireEvent.click(await screen.findByTestId('design-scratch'))
      await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/alpha', { template: undefined, designSystemId: 'fin-one' }))

      const card = screen.getByText('Title saas').closest('[data-testid="design-template-card"]') as HTMLElement
      fireEvent.click(within(card).getByRole('button', { name: 'Preview' }))
      await screen.findByTestId('design-template-preview')
      fireEvent.click(screen.getByRole('button', { name: 'Use this template' }))
      await waitFor(() => expect(mocks.startDesignSession).toHaveBeenLastCalledWith('/work/alpha', { template: { id: 'saas', title: 'Title saas' }, designSystemId: 'fin-one' }))
    })

    it('clears the chosen system', async () => {
      await openSystems()
      fireEvent.click(within(screen.getByText('System paper').closest('[data-testid="design-system-card"]') as HTMLElement).getByRole('button', { name: 'Use this system' }))

      fireEvent.click(screen.getByRole('button', { name: 'Clear the design system' }))

      expect(screen.queryByTestId('design-system-chip')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('radio', { name: 'Templates' }))
      fireEvent.click(await screen.findByTestId('design-scratch'))
      await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/alpha', { template: undefined, designSystemId: undefined }))
    })

    it('does not pass the system to a template with a fixed look and says so on its card', async () => {
      mocks.templates.mockResolvedValue({ version: 1, templates: [{ ...template('fixed', 'web', null), acceptsDesignSystem: false }, template('saas', 'web')] })
      await openSystems()
      fireEvent.click(within(screen.getByText('System paper').closest('[data-testid="design-system-card"]') as HTMLElement).getByRole('button', { name: 'Use this system' }))
      fireEvent.click(screen.getByRole('radio', { name: 'Templates' }))

      const fixed = (await screen.findByText('Title fixed')).closest('[data-testid="design-template-card"]') as HTMLElement
      expect(within(fixed).getByText('Fixed look: the chosen design system is not applied.')).toBeInTheDocument()
      expect(screen.getAllByText('Fixed look: the chosen design system is not applied.')).toHaveLength(1)
      fireEvent.click(within(fixed).getByRole('button', { name: 'Use this template' }))

      await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/alpha', { template: { id: 'fixed', title: 'Title fixed' }, designSystemId: undefined }))
    })
  })

  describe('website clone', () => {
    const form = async () => {
      render(<DesignMode />)
      await screen.findByText('Title saas')
      return screen.getByTestId('design-clone')
    }

    it('starts a chat that clones the address in the first project', async () => {
      const clone = await form()
      fireEvent.change(within(clone).getByRole('textbox', { name: 'Website address' }), { target: { value: 'example.com' } })
      fireEvent.click(within(clone).getByRole('button', { name: 'Start cloning' }))

      await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/alpha', { cloneAddress: 'https://example.com/' }))
      await waitFor(() => expect(useArtifactViewStore.getState().designing).toBe(false))
    })

    it('starts the clone with the enter key too', async () => {
      const clone = await form()
      const input = within(clone).getByRole('textbox', { name: 'Website address' })
      fireEvent.change(input, { target: { value: 'https://example.com/page' } })
      fireEvent.submit(clone)
      await waitFor(() => expect(mocks.startDesignSession).toHaveBeenCalledWith('/work/alpha', { cloneAddress: 'https://example.com/page' }))
    })

    it('does not start with an address that is not a web address, and says so until the user types again', async () => {
      const clone = await form()
      const input = within(clone).getByRole('textbox', { name: 'Website address' })
      fireEvent.change(input, { target: { value: 'file:///etc/passwd' } })
      fireEvent.click(within(clone).getByRole('button', { name: 'Start cloning' }))

      expect(await within(clone).findByRole('alert')).toHaveTextContent('Enter a web address')
      expect(mocks.startDesignSession).not.toHaveBeenCalled()
      fireEvent.change(input, { target: { value: 'example.com' } })
      expect(within(clone).queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps the button off while the field is empty', async () => {
      const clone = await form()
      expect(within(clone).getByRole('button', { name: 'Start cloning' })).toBeDisabled()
    })

    it('tells the user when starting failed and stays on the page', async () => {
      mocks.startDesignSession.mockRejectedValue(new Error('disk full'))
      const clone = await form()
      fireEvent.change(within(clone).getByRole('textbox', { name: 'Website address' }), { target: { value: 'example.com' } })
      fireEvent.click(within(clone).getByRole('button', { name: 'Start cloning' }))
      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('disk full'))
      expect(useArtifactViewStore.getState().designing).toBe(true)
    })

    it('is offered in Chinese', async () => {
      useSettingsStore.setState({ locale: 'zh' })
      render(<DesignMode />)
      await screen.findByText('标题 saas')
      expect(screen.getByRole('textbox', { name: '网站地址' })).toBeInTheDocument()
    })
  })
})

