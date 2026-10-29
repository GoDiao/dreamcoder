import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { SHOW_UI_ENABLED_ENV } from '../../tools/ShowUITool/constants.js'
import {
  applyShowUiInput,
  COMPONENT_DOCS_LANGUAGE_NOTE,
  guidanceProblem,
  sessionGuidance,
  ShowUITool,
  showUiForm,
  showUiInputProblem,
  showUiOutput,
} from '../../tools/ShowUITool/ShowUITool.js'
import {
  changeUiPage,
  createUiPage,
  describeUiPageKinds,
  listUiPageComponents,
  isUiPageKind,
  listUiPages,
  readLatestUiPage,
  readUiPageRevision,
  UI_PAGE_KINDS,
  UI_PAGE_MAX_BYTES,
  uiPageBlocks,
  UiPageError,
} from '../../utils/uiPages.js'
import { buildG2Fields } from '../../../vendor/showai/build-g2-fields.js'
import g2Fields from '../../../vendor/showai/resources/catalog/g2-fields.json'
import g2Catalog from '../../../vendor/showai/resources/catalog/g2.json'
import { shouldBlockDisabledH5Access } from '../h5AccessPolicy.js'
import { sessionService } from '../services/sessionService.js'
import { restoreSessionFields } from '../session/persistence.js'
import { createSessionState, reduceSessionState } from '../session/state/reducer.js'
import { sessionStateStore } from '../session/state/store.js'
import {
  handleUiPageRequest,
  UI_PAGE_CONTENT_SECURITY_POLICY,
} from '../uiPageHost.js'
import {
  __resetWebSocketHandlerStateForTests,
  getSessionState,
  handleWebSocket,
  translateCliMessage,
  type WebSocketData,
} from '../ws/handler.js'
import { UI_PAGE_BOOTSTRAP_HTML } from '../uiPageBootstrap.js'

let sessionDir: string

beforeEach(async () => {
  sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'show-ui-'))
})

afterEach(async () => {
  mock.restore()
  __resetWebSocketHandlerStateForTests()
  await fs.rm(sessionDir, { recursive: true, force: true })
})

async function rejection(promise: Promise<unknown>): Promise<UiPageError> {
  try {
    await promise
  } catch (error) {
    return error as UiPageError
  }
  throw new Error('expected the call to be rejected')
}

const chart = (values: number[], type = 'bar') => ({
  kind: 'chart',
  data: { title: 'Revenue', type, labels: values.map((_, index) => `Q${index + 1}`), series: [{ name: 'Revenue', values }] },
})
const text = (content: string) => ({ kind: 'text', data: { format: 'markdown', content } })

function widgetData(revision: { artifact: { document: { content: { content?: { attrs?: Record<string, unknown> }[] } } } }, kind: string) {
  return revision.artifact.document.content.content?.find((node) => node.attrs?.kind === kind)?.attrs?.data as Record<string, unknown>
}

describe('page store', () => {
  it('reads a missing page as absent but reports a revision file it cannot read', async () => {
    expect(await listUiPages(sessionDir)).toEqual([])
    expect(await readUiPageRevision(sessionDir, 'a'.repeat(24), 1)).toBeNull()

    const page = await createUiPage(sessionDir, { title: 'Revenue', blocks: [chart([1])] })
    const file = path.join(sessionDir, 'ui-pages', page.pageId, '1.json')
    await fs.chmod(file, 0o644)
    await fs.writeFile(file, '{ not json')

    await expect(readUiPageRevision(sessionDir, page.pageId, 1)).rejects.toThrow(SyntaxError)
    expect(await readUiPageRevision(sessionDir, page.pageId, 2)).toBeNull()
  })

  it('creates a page from blocks at revision 1 and keeps every revision as its own file', async () => {
    const first = await createUiPage(sessionDir, { title: 'Revenue', blocks: [text('# Revenue'), chart([3, 5])] })
    const blockId = uiPageBlocks(first.artifact.document).find((block) => block.kind === 'chart')!.id
    const second = await changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [{ type: 'component.props.set', blockId, props: { type: 'line' } }],
    })

    expect(first.revision).toBe(1)
    expect(second.revision).toBe(2)
    expect(second.title).toBe('Revenue')
    expect(first.artifact).toMatchObject({ format: 'showai', version: 3 })
    expect(widgetData((await readUiPageRevision(sessionDir, first.pageId, 1))!, 'chart').type).toBe('bar')
    expect(widgetData((await readUiPageRevision(sessionDir, first.pageId, 2))!, 'chart').type).toBe('line')
    expect(await listUiPages(sessionDir)).toEqual([{ pageId: first.pageId, revision: 2, title: 'Revenue' }])
  })

  it('renames, inserts and removes blocks by id', async () => {
    const first = await createUiPage(sessionDir, { title: 'Draft', blocks: [text('intro'), chart([1])] })
    const [intro] = uiPageBlocks(first.artifact.document)
    const second = await changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [
        { type: 'page.set', fields: { title: 'Final' } },
        { type: 'block.remove', blockId: intro!.id },
        { type: 'component.insert', kind: 'table', data: { title: '', columns: ['A'], rows: [['1']] } },
      ],
    })

    expect(second.title).toBe('Final')
    expect(uiPageBlocks(second.artifact.document).map((block) => block.kind)).toEqual(['chart', 'table'])
    expect((await readUiPageRevision(sessionDir, first.pageId, 1))?.title).toBe('Draft')
  })

  it('saves nothing when a block is invalid or an operation fails', async () => {
    const invalid = await rejection(createUiPage(sessionDir, { title: 'Bad', blocks: [{ kind: 'chart', data: { series: 'x' } }] }))
    const first = await createUiPage(sessionDir, { title: 'Calc', blocks: [chart([1])] })
    const missing = await rejection(changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [{ type: 'block.remove', blockId: 'no-such-block' }],
    }))

    expect(invalid.code).toBe('invalid_page')
    expect(invalid.message).toContain('series')
    expect(missing.code).toBe('invalid_page')
    expect(missing.message).toContain('No change was saved')
    expect(await listUiPages(sessionDir)).toEqual([{ pageId: first.pageId, revision: 1, title: 'Calc' }])
  })

  it('tells plain blocks from components and explains how to change a plain block', async () => {
    const first = await createUiPage(sessionDir, {
      title: 'Mixed',
      blocks: [text('intro'), { kind: 'callout', data: { title: 'Note', content: 'old' } }, chart([1])],
    })
    const blocks = uiPageBlocks(first.artifact.document)
    const callout = blocks.find((block) => block.kind === 'callout')!

    const rejected = await rejection(changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [{ type: 'component.props.set', blockId: callout.id, props: { content: 'new' } }],
    }))
    const replaced = await changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [
        { type: 'block.remove', blockId: callout.id },
        { type: 'component.insert', kind: 'callout', data: { title: 'Note', content: 'new' }, afterId: blocks[0]!.id },
      ],
    })

    expect(blocks.map(({ kind, component }) => ({ kind, component }))).toEqual([
      { kind: 'text', component: false },
      { kind: 'callout', component: false },
      { kind: 'chart', component: true },
    ])
    expect(rejected.code).toBe('invalid_page')
    expect(rejected.message).toContain(`Block ${callout.id} is a plain callout block, not a component`)
    expect(rejected.message).toContain('block.remove')
    expect(uiPageBlocks(replaced.artifact.document).map((block) => block.kind)).toEqual(['text', 'callout', 'chart'])
  })

  it('stores an html block as a ShowAI custom component the reader can mount', async () => {
    const html = '<!doctype html><html><body><svg id="s"></svg><script>document.getElementById("s")</script></body></html>'
    const page = await createUiPage(sessionDir, { title: 'Concept', blocks: [text('intro'), { kind: 'html', data: { reason: 'No component draws this.', html, title: 'Links' } }] })
    const widget = page.artifact.document.content.content!.find((node) => node.type === 'widget')!
    const component = page.artifact.components![0]!

    expect(uiPageBlocks(page.artifact.document).map(({ kind, component: isComponent }) => ({ kind, isComponent }))).toEqual([
      { kind: 'text', isComponent: false },
      { kind: 'html', isComponent: false },
    ])
    expect(widget.attrs).toMatchObject({ kind: 'custom', data: { componentId: component.id, version: '1.0.0', integrity: component.integrity, props: {} } })
    expect(component).toMatchObject({ id: expect.stringMatching(/^dc-html-[0-9a-f]{16}$/), name: 'Links', schema: true })
    expect(component.inline.script).toContain('ShowAIInlineComponent')
    expect(component.inline.script).toContain("setAttribute('sandbox','allow-scripts')")
    expect(component.inline.script).toContain(JSON.stringify(html).slice(1, 40))
    expect((await readUiPageRevision(sessionDir, page.pageId, 1))?.artifact.components).toEqual([component])
  })

  it('replaces an html block by removing and inserting it, and drops the unused component', async () => {
    const first = await createUiPage(sessionDir, { title: 'Concept', blocks: [{ kind: 'html', data: { reason: 'No component draws this.', html: '<p>one</p>' } }] })
    const [block] = uiPageBlocks(first.artifact.document)
    const propsSet = await rejection(changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [{ type: 'component.props.set', blockId: block!.id, props: { html: '<p>two</p>' } }],
    }))
    const second = await changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [
        { type: 'block.remove', blockId: block!.id },
        { type: 'component.insert', kind: 'html', data: { reason: 'No component draws this.', html: '<p>two</p>' } },
      ],
    })

    expect(propsSet.message).toContain('is a plain html block, not a component')
    expect(second.artifact.components).toHaveLength(1)
    expect(second.artifact.components![0]!.inline.script).toContain('<p>two</p>')
    expect(second.artifact.components![0]!.integrity).not.toBe(first.artifact.components![0]!.integrity)
  })

  it('rejects invalid html blocks and custom blocks the agent did not write as html', async () => {
    const empty = await rejection(createUiPage(sessionDir, { title: 'x', blocks: [{ kind: 'html', data: { reason: 'No component draws this.', html: ' ' } }] }))
    const extra = await rejection(createUiPage(sessionDir, { title: 'x', blocks: [{ kind: 'html', data: { reason: 'No component draws this.', html: '<p/>', script: 'x' } }] }))
    const fixed = await rejection(createUiPage(sessionDir, { title: 'x', blocks: [{ kind: 'html', data: { reason: 'No component draws this.', html: '<p/>', height: 980 } }] }))
    const unexplained = await rejection(createUiPage(sessionDir, { title: 'x', blocks: [{ kind: 'html', data: { html: '<p/>', reason: ' ' } }] }))
    const custom = await rejection(createUiPage(sessionDir, {
      title: 'x',
      blocks: [{ kind: 'custom', data: { componentId: 'dc-html-0000000000000000', version: '1.0.0', integrity: `sha256-${'0'.repeat(64)}`, props: {} } }],
    }))

    expect(empty.message).toContain('needs data.html')
    expect(extra.message).toContain('takes only html, title and reason, not script')
    expect(unexplained.message).toContain('needs data.reason: name the components you considered')
    expect(fixed.message).toContain('not height; its height follows the content')
    expect(custom.message).toContain('Unsupported component kind custom')
    expect(await listUiPages(sessionDir)).toEqual([])
  })

  it('accepts the official example of every G2 chart', async () => {
    const examples = (g2Catalog as { kind: string; defaultData: Record<string, unknown>; examples?: { data?: Record<string, unknown> }[] }[])
      .map((entry) => ({ kind: entry.kind, data: entry.examples?.[0]?.data ?? entry.defaultData }))

    for (const block of examples) {
      await createUiPage(sessionDir, { title: block.kind, blocks: [block] })
    }

    expect((await listUiPages(sessionDir)).length).toBe(examples.length)
  })

  it('rejects a G2 chart whose records lack the fields it reads, and accepts them once mapped', async () => {
    const records = [{ label: 'NVDA', value: -1.17 }, { label: 'MU', value: 5.86 }]
    const unmapped = await rejection(createUiPage(sessionDir, { title: 'Daily', blocks: [{ kind: 'g2-bar', data: { datasets: { main: records } } }] }))
    const wrongKey = await rejection(createUiPage(sessionDir, {
      title: 'Daily',
      blocks: [{ kind: 'g2-bar', data: { datasets: { data: records }, fields: { genre: 'label', sold: 'value' } } }],
    }))
    const mapped = await createUiPage(sessionDir, {
      title: 'Daily',
      blocks: [{ kind: 'g2-bar', data: { datasets: { main: records }, fields: { genre: 'label', sold: 'value' } } }],
    })
    const renamed = await createUiPage(sessionDir, {
      title: 'Daily',
      blocks: [{ kind: 'g2-bar', data: { datasets: { main: [{ genre: 'NVDA', sold: 1 }] } } }],
    })

    expect(unmapped.code).toBe('invalid_page')
    expect(unmapped.message).toContain('g2-bar reads the fields genre, sold from datasets.main, but your records have no genre, sold (they have label, value)')
    expect(unmapped.message).toContain('fields: {"genre":"<your field>","sold":"<your field>"}')
    expect(wrongKey.message).toContain('g2-bar needs datasets.main')
    expect(mapped.revision).toBe(1)
    expect(renamed.revision).toBe(1)
  })

  it('checks G2 fields on changes too', async () => {
    const first = await createUiPage(sessionDir, { title: 'Daily', blocks: [chart([1])] })
    const inserted = await rejection(changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [{ type: 'component.insert', kind: 'g2-pie', data: { datasets: { main: [{ name: 'a', share: 1 }] } } }],
    }))

    expect(inserted.message).toContain('g2-pie reads the fields browser, value')
    expect((await listUiPages(sessionDir))[0]!.revision).toBe(1)
  })

  it('keeps the G2 field list in step with the vendored chart sources', () => {
    expect(g2Fields).toEqual(buildG2Fields())
  })

  it('accepts only the supported components', async () => {
    const video = await rejection(createUiPage(sessionDir, { title: 'Doc', blocks: [{ kind: 'video', data: {} }] }))
    const first = await createUiPage(sessionDir, { title: 'Ok', blocks: [chart([1])] })
    const inserted = await rejection(changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [{ type: 'component.insert', kind: 'bookmark', data: {} }],
    }))

    expect(video.code).toBe('invalid_page')
    expect(video.message).toContain('Unsupported component kind video')
    expect(inserted.message).toContain('bookmark')
    expect(isUiPageKind('g2-bar')).toBe(true)
    expect(isUiPageKind('flowchart')).toBe(true)
    expect(isUiPageKind('archify')).toBe(true)
    expect(await listUiPages(sessionDir)).toEqual([{ pageId: first.pageId, revision: 1, title: 'Ok' }])
  })

  it('rejects a stale baseRevision and tells the agent to read the latest revision through ShowUI', async () => {
    const first = await createUiPage(sessionDir, { title: 'Calc', blocks: [chart([1])] })
    await changeUiPage(sessionDir, { pageId: first.pageId, baseRevision: 1, operations: [{ type: 'page.set', fields: { title: 'Two' } }] })

    const stale = await rejection(changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [{ type: 'page.set', fields: { title: 'Three' } }],
    }))

    expect(stale.code).toBe('conflict')
    expect(stale.message).toContain('revision 2')
    expect(stale.message).toContain(`Read the latest revision first with ShowUI({ pageId: "${first.pageId}" })`)
    expect(stale.message).not.toContain(sessionDir)
    expect((await listUiPages(sessionDir))[0]!.revision).toBe(2)
  })

  it('writes every revision read-only so other tools cannot change it in place', async () => {
    const first = await createUiPage(sessionDir, { title: 'Chart', blocks: [chart([1])] })
    const file = path.join(sessionDir, 'ui-pages', first.pageId, '1.json')

    expect((await fs.stat(file)).mode & 0o222).toBe(0)
    await expect(fs.writeFile(file, '{}')).rejects.toThrow()
    expect((await readUiPageRevision(sessionDir, first.pageId, 1))?.title).toBe('Chart')
  })

  it('lets only one of two writers on the same revision succeed', async () => {
    const first = await createUiPage(sessionDir, { title: 'Calc', blocks: [chart([1])] })
    const change = (title: string) => changeUiPage(sessionDir, {
      pageId: first.pageId,
      baseRevision: 1,
      operations: [{ type: 'page.set', fields: { title } }],
    })

    const results = await Promise.allSettled([change('A'), change('B')])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'conflict' } })
  })

  it('enforces the size limit', async () => {
    const big = await rejection(createUiPage(sessionDir, { title: 'Big', blocks: [text('x'.repeat(UI_PAGE_MAX_BYTES))] }))
    expect(big.code === 'too_large' || big.code === 'invalid_page').toBe(true)
    expect(await listUiPages(sessionDir)).toEqual([])
  })

  it('does not accept page ids that could leave the page directory', async () => {
    expect(await readUiPageRevision(sessionDir, '../x', 1)).toBeNull()
    expect((await rejection(readLatestUiPage(sessionDir, '../../etc'))).code).toBe('not_found')
  })
})

describe('ShowUI tool', () => {
  it('is available only to CLI processes the sidecar starts for the app', () => {
    const previous = process.env[SHOW_UI_ENABLED_ENV]
    try {
      delete process.env[SHOW_UI_ENABLED_ENV]
      expect(ShowUITool.isEnabled()).toBe(false)
      process.env[SHOW_UI_ENABLED_ENV] = '1'
      expect(ShowUITool.isEnabled()).toBe(true)
    } finally {
      if (previous === undefined) delete process.env[SHOW_UI_ENABLED_ENV]
      else process.env[SHOW_UI_ENABLED_ENV] = previous
    }
  })

  it('tells the agent to build pages from components and change them only through the tool', async () => {
    const prompt = await ShowUITool.prompt({} as never)
    expect(prompt).toContain('an html block holds a self-contained HTML document you write')
    expect(prompt).toContain("Choose in this order: adjust an existing component's data and layout, combine several components, and only then write html")
    expect(prompt).toContain('An html block must say in its reason which components you considered')
    expect(prompt).toContain('walk through it with step-walkthrough or stepper')
    expect(prompt).toContain('There are no separate Catalog, Describe or Read tools for pages')
    expect(prompt).toContain('- ShowUI({ catalog: true }) lists every component')
    expect(prompt).toContain('- ShowUI({ describe: ["chart", "mindmap"] }) returns')
    expect(prompt).toContain('- ShowUI({ pageId }) returns the latest revision')
    expect(prompt).toContain("in the language of the user's messages, not in the language of the documentation")
    expect(prompt).toContain("returns each component's guide (field meanings, recipes and constraints)")
    expect(prompt).toContain('blocks and operations are JSON arrays, never strings')
    expect(prompt).toContain('It works only on blocks returned with component: true')
    expect(prompt).toContain('For a plain bar or line chart use chart')
    expect(prompt).toContain('give flowcharts with more than four steps direction "TB"')
    expect(prompt).toContain('You cannot see the rendered page: to check what a page holds, read it with ShowUI({ pageId })')
    expect(prompt).not.toMatch(/^- (Catalog|Describe|Create|Change|Read):/m)
    expect(prompt).toContain('A create or insert with a kind you have not described is rejected')
    expect(prompt).toContain('component.props.set')
    expect(prompt).toContain('Never read or edit page files with other tools')
    expect(prompt).toContain('do not repeat its data')
    for (const kind of UI_PAGE_KINDS) expect(prompt).toContain(kind)
  })

  it('tells the agent to use it for any request to chart or visualize data instead of scripts, files or project code', async () => {
    const description = await ShowUITool.description({} as never, {} as never)
    const prompt = await ShowUITool.prompt({} as never)

    expect(description).toContain('Use it whenever the user asks to chart, plot, graph, draw or visualize data or a table')
    expect(prompt).toContain('"Show it on the page" or "draw it in the page" also means this tool')
    expect(prompt).toContain('do not first ask which tool or output format to use')
    expect(prompt).toContain('Do not write plotting scripts (matplotlib and the like), generate image or HTML files, or change the project\'s code')
  })

  it('creates, changes and reads a page through its input and returns block ids', async () => {
    const created = await applyShowUiInput(sessionDir, { title: 'Chart', blocks: [chart([1, 2])] })
    const blocks = showUiOutput({ title: 'Chart', blocks: [chart([1, 2])] }, created).blocks!
    const changed = await applyShowUiInput(sessionDir, {
      pageId: created.pageId,
      baseRevision: 1,
      operations: [{ type: 'component.props.set', blockId: blocks[0]!.id, props: { type: 'line' } }],
    })
    const read = await applyShowUiInput(sessionDir, { pageId: created.pageId })

    expect(blocks).toEqual([{ id: expect.any(String), kind: 'chart', component: true }])
    expect(changed.revision).toBe(2)
    expect(showUiOutput({ pageId: created.pageId }, read)).toMatchObject({ pageId: created.pageId, revision: 2, title: 'Chart', page: { title: 'Chart' } })
    expect(showUiOutput({ pageId: created.pageId }, read)).not.toHaveProperty('blocks')
    expect((await rejection(applyShowUiInput(sessionDir, { pageId: 'b'.repeat(24) }))).code).toBe('not_found')
  })

  it('lists the supported components and describes several at once', async () => {
    const components = await listUiPageComponents()
    const [chartFormat, g2] = await describeUiPageKinds(['chart', 'g2-bar'])

    expect(components.map((component) => component.kind)).toEqual(expect.arrayContaining(['text', 'chart', 'mindmap', 'g2-bar']))
    expect(components.map((component) => component.kind)).toEqual(expect.arrayContaining(['step-walkthrough', 'stepper', 'scene-3d', 'pdf', 'archify', 'diagram-design', 'fireworks-tech-graph']))
    expect(components.map((component) => component.kind)).not.toEqual(expect.arrayContaining(['image']))
    for (const media of ['image', 'gallery', 'video', 'audio', 'bookmark']) expect(isUiPageKind(media)).toBe(false)
    expect((await describeUiPageKinds(['archify']))[0]?.guide).toBeDefined()
    expect(components.find((component) => component.kind === 'html')?.signature).toStartWith('html { html: string')
    expect((await describeUiPageKinds(['html']))[0]).toMatchObject({ kind: 'html', guide: { usage: expect.any(Object) }, examples: expect.any(Array) })
    expect(components.every((component) => typeof component.description === 'string')).toBe(true)
    expect(components.find((component) => component.kind === 'chart')?.signature).toStartWith('chart { labels: string[], series:')
    expect(chartFormat).toMatchObject({ kind: 'chart', propsSchema: expect.any(Object), examples: expect.any(Array) })
    expect(g2!.kind).toBe('g2-bar')
    expect(JSON.stringify(g2!.guide)).toContain('fields')
    expect(JSON.stringify(g2!.guide)).toContain('示例预期字段')
    expect(chartFormat!.guide).toMatchObject({ usage: expect.any(Object) })
    expect((await rejection(describeUiPageKinds(['chart', 'video']))).code).toBe('not_found')
  })

  it('rejects a page until the agent has listed the components and read the format of each kind it uses', () => {
    const create = { title: 'Revenue', blocks: [text('intro'), chart([1]), { kind: 'mindmap', data: {} }] }
    const insert = {
      pageId: 'a'.repeat(24),
      baseRevision: 1,
      operations: [{ type: 'component.insert', kind: 'flowchart', data: {} }, { type: 'page.set', fields: { title: 't' } }],
    }
    const guidance = { catalog: false, kinds: new Set<string>() }

    expect(guidanceProblem(create, guidance)).toContain('ShowUI({ catalog: true })')
    guidance.catalog = true
    expect(guidanceProblem(create, guidance)).toContain('ShowUI({ describe: ["chart","mindmap"] })')
    guidance.kinds.add('chart')
    expect(guidanceProblem(create, guidance)).toContain('["mindmap"]')
    guidance.kinds.add('mindmap')
    expect(guidanceProblem(create, guidance)).toBeNull()
    expect(guidanceProblem({ title: 'Notes', blocks: [text('x')] }, guidance)).toBeNull()
    expect(guidanceProblem({ title: 'Concept', blocks: [{ kind: 'html', data: { reason: 'No component draws this.', html: '<p/>' } }] }, guidance)).toContain('["html"]')
    expect(guidanceProblem(insert, guidance)).toContain('["flowchart"]')
    expect(guidanceProblem({ ...insert, operations: [{ type: 'component.insert', kind: null, data: {} }] }, guidance)).toBeNull()
    expect(guidanceProblem({ pageId: 'a'.repeat(24) }, { catalog: false, kinds: new Set() })).toBeNull()
  })

  it('enforces the steps when the tool is called', async () => {
    const create = { title: 'Revenue', blocks: [chart([1])] }
    const call = (input: Record<string, unknown>) => ShowUITool.call(input as never, {} as never, undefined as never, undefined as never)

    expect(await ShowUITool.validateInput!(create, {} as never)).toMatchObject({ result: false, message: expect.stringContaining('catalog') })
    expect((await call({ catalog: true })).data.note).toBe(COMPONENT_DOCS_LANGUAGE_NOTE)
    expect(await ShowUITool.validateInput!(create, {} as never)).toMatchObject({ result: false, message: expect.stringContaining('["chart"]') })
    expect((await call({ describe: ['chart'] })).data.note).toBe(COMPONENT_DOCS_LANGUAGE_NOTE)
    expect(await ShowUITool.validateInput!(create, {} as never)).toEqual({ result: true })
  })

  it('remembers listed and described components for the session that called it', async () => {
    const sessionId = `guidance-${crypto.randomUUID()}`
    const guidance = sessionGuidance(sessionId)
    const create = { title: 'Revenue', blocks: [chart([1])] }

    expect(guidanceProblem(create, guidance)).not.toBeNull()
    guidance.catalog = true
    guidance.kinds.add('chart')
    expect(guidanceProblem(create, sessionGuidance(sessionId))).toBeNull()
    expect(guidanceProblem(create, sessionGuidance(`${sessionId}-other`))).not.toBeNull()
  })

  it('accepts blocks and operations that the model sent as JSON strings', () => {
    const schema = ShowUITool.inputSchema
    const blocks = [chart([1])]
    const operations = [{ type: 'page.set', fields: { title: 't' } }]

    expect(schema.parse({ title: 'Chart', blocks: JSON.stringify(blocks) })).toEqual({ title: 'Chart', blocks })
    expect(schema.parse({ pageId: 'a'.repeat(24), baseRevision: 1, operations: JSON.stringify(operations) }).operations).toEqual(operations)
    expect(schema.safeParse({ title: 'Chart', blocks: 'not json' }).success).toBe(false)
    expect(schema.safeParse({ title: 'Chart', blocks: '{"kind":"chart"}' }).success).toBe(false)
    const cutOff = schema.safeParse({ title: 'Chart', blocks: JSON.stringify(blocks).slice(0, -2) })
    const [issue] = cutOff.error?.issues ?? []
    expect(cutOff.success).toBe(false)
    expect(issue?.path).toEqual(['blocks'])
    expect(String(issue?.message)).toContain('was sent as a string that is not valid JSON')
    expect(String(issue?.message)).toContain('so it may be cut off')
    expect(String(issue?.message)).toContain('keep each call small')
  })

  it('accepts exactly one form', () => {
    const id = 'a'.repeat(24)
    const ops = [{ type: 'page.set', fields: { title: 't' } }]
    expect(showUiForm({ title: 't', blocks: [chart([1])] })).toBe('create')
    expect(showUiForm({ pageId: id, baseRevision: 1, operations: ops })).toBe('change')
    expect(showUiForm({ pageId: id })).toBe('read')
    expect(showUiForm({ describe: ['chart'] })).toBe('describe')
    expect(showUiForm({ catalog: true })).toBe('catalog')
    expect(showUiInputProblem({ title: 't' })).toContain('exactly one form')
    expect(showUiInputProblem({ pageId: id, operations: ops })).toContain('exactly one form')
    expect(showUiInputProblem({ pageId: id, describe: ['chart'] })).toContain('exactly one form')
    expect(showUiInputProblem({ catalog: true, describe: ['chart'] })).toContain('exactly one form')
    expect(showUiInputProblem({ title: 't', blocks: [chart([1])], pageId: id })).toContain('exactly one form')
  })
})

describe('session state', () => {
  const pageId = 'b'.repeat(24)

  it('records pages and keeps the highest revision of each', () => {
    let state = createSessionState('s1')
    state = reduceSessionState(state, { type: 'ui_page_reported', page: { pageId, title: 'A', revision: 2 } }).state
    const stale = reduceSessionState(state, { type: 'ui_page_reported', page: { pageId, title: 'A', revision: 1 } })
    const next = reduceSessionState(state, { type: 'ui_page_reported', page: { pageId, title: 'B', revision: 3 } })

    expect(stale.patch).toEqual({})
    expect(next.state.uiPages).toEqual([{ pageId, title: 'B', revision: 3 }])
    expect(next.patch).toEqual({ uiPages: [{ pageId, title: 'B', revision: 3 }] })
  })

  it('merges restored pages with ones reported before the restore finished', () => {
    const live = reduceSessionState(createSessionState('s1'), {
      type: 'ui_page_reported',
      page: { pageId, title: 'Live', revision: 4 },
    }).state
    const restored = reduceSessionState(live, {
      type: 'restored',
      fields: {
        permissionMode: 'default',
        runtime: null,
        title: { text: null, source: null },
        workspace: { workDir: '/repo', projectRoot: null, workDirExists: true },
        uiPages: [{ pageId, title: 'Disk', revision: 3 }, { pageId: 'c'.repeat(24), title: 'Other', revision: 1 }],
      },
    }).state

    expect(restored.uiPages).toEqual([
      { pageId, title: 'Live', revision: 4 },
      { pageId: 'c'.repeat(24), title: 'Other', revision: 1 },
    ])
  })

  it('reads the pages on disk when a session is restored', async () => {
    const page = await createUiPage(sessionDir, { title: 'Saved', blocks: [chart([1])] })
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue(null)
    spyOn(sessionService, 'getSessionDataDir').mockResolvedValue(sessionDir)

    const fields = await restoreSessionFields('s1')

    expect(fields?.uiPages).toEqual([{ pageId: page.pageId, title: 'Saved', revision: 1 }])
  })
})

describe('page sync across clients', () => {
  function makeClient(sessionId: string) {
    const sent: string[] = []
    return {
      data: {
        sessionId,
        connectedAt: Date.now(),
        channel: 'client',
        clientKind: 'desktop',
        sdkToken: null,
        serverPort: 0,
        serverHost: '127.0.0.1',
      },
      send: mock((payload: string) => {
        sent.push(payload)
      }),
      close: mock(() => {}),
      sent,
    } as unknown as ServerWebSocket<WebSocketData> & { sent: string[] }
  }

  async function snapshotOf(client: ReturnType<typeof makeClient>) {
    for (let i = 0; i < 50; i++) {
      const snapshot = client.sent.map((payload) => JSON.parse(payload)).find((message) => message.type === 'session_snapshot')
      if (snapshot) return snapshot
      await Bun.sleep(5)
    }
    throw new Error('no snapshot')
  }

  const pageId = 'd'.repeat(24)
  const toolUse = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'ShowUI', input: {} }] } }
  const toolResult = (isError: boolean, revision = 1) => ({
    type: 'user',
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: 'tu1',
        is_error: isError,
        content: JSON.stringify({ pageId, revision, title: 'Login page' }),
      }],
    },
  })

  it('shows a page created in a session to a client that connects afterwards', async () => {
    const sessionId = `show-ui-${crypto.randomUUID()}`
    spyOn(sessionService, 'getSessionRestoreInfo').mockResolvedValue(null)
    spyOn(sessionService, 'getSessionDataDir').mockResolvedValue(null)
    const first = makeClient(sessionId)
    handleWebSocket.open(first)
    await snapshotOf(first)
    first.sent.length = 0

    translateCliMessage(toolUse, sessionId)
    translateCliMessage(toolResult(false), sessionId)

    const patch = first.sent.map((payload) => JSON.parse(payload)).find((message) => message.type === 'session_patch')
    expect(patch.changes.uiPages).toEqual([{ pageId, title: 'Login page', revision: 1 }])

    const second = makeClient(sessionId)
    handleWebSocket.open(second)
    const snapshot = await snapshotOf(second)
    expect(snapshot.state.uiPages).toEqual([{ pageId, title: 'Login page', revision: 1 }])
  })

  it('records a later revision on the same page and ignores a failed call', () => {
    const sessionId = `show-ui-${crypto.randomUUID()}`
    translateCliMessage(toolUse, sessionId)
    translateCliMessage(toolResult(false, 1), sessionId)
    translateCliMessage(toolUse, sessionId)
    translateCliMessage(toolResult(false, 2), sessionId)
    translateCliMessage(toolUse, sessionId)
    translateCliMessage(toolResult(true, 3), sessionId)

    expect(getSessionState(sessionId)?.uiPages).toEqual([{ pageId, title: 'Login page', revision: 2 }])
  })

  it('does not read the result of another tool as a page', () => {
    const sessionId = `show-ui-${crypto.randomUUID()}`
    translateCliMessage({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: {} }] } }, sessionId)
    translateCliMessage(toolResult(false), sessionId)

    expect(getSessionState(sessionId)?.uiPages ?? []).toEqual([])
  })
})

describe('page host', () => {
  const sessionId = 'host-session'

  async function serve(pathname: string, method = 'GET') {
    const url = new URL(`http://127.0.0.1:3456${pathname}`)
    return handleUiPageRequest(new Request(url, { method }), url)
  }

  it('serves a revision as the reader shell with the offline CSP, an opaque-origin sandbox and the bridge', async () => {
    const page = await createUiPage(sessionDir, { title: '</script><b>x', blocks: [chart([1])] })
    spyOn(sessionService, 'getSessionDataDir').mockResolvedValue(sessionDir)

    const response = await serve(`/ui-pages/${sessionId}/${page.pageId}/1`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('Content-Security-Policy')).toBe(UI_PAGE_CONTENT_SECURITY_POLICY)
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toContain(UI_PAGE_BOOTSTRAP_HTML)
    expect(body).toContain('import("/showai-reader/reader.js")')
    expect(body).toContain('\\u003c/script>\\u003cb>x')
    expect(body).not.toContain('</script><b>x')
  })

  it('serves the reader modules from the frontend build to the opaque-origin page', async () => {
    const dist = path.join(sessionDir, 'dist')
    await fs.mkdir(path.join(dist, 'showai-reader', 'chunks'), { recursive: true })
    await fs.writeFile(path.join(dist, 'showai-reader', 'reader.js'), 'export const mount = 1')
    const previous = process.env.CLAUDE_H5_DIST_DIR
    process.env.CLAUDE_H5_DIST_DIR = dist
    try {
      const reader = await serve('/showai-reader/reader.js')

      expect(reader.status).toBe(200)
      expect(reader.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8')
      expect(reader.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(await reader.text()).toBe('export const mount = 1')
      expect((await serve('/showai-reader/chunks/missing.js')).status).toBe(404)
      expect((await serve('/showai-reader/..%2F..%2Fpackage.json')).status).toBe(404)
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_H5_DIST_DIR
      else process.env.CLAUDE_H5_DIST_DIR = previous
    }
  })

  it('pins the CSP string', () => {
    expect(UI_PAGE_CONTENT_SECURITY_POLICY).toBe(
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
    )
  })

  it('never lets the document keep the origin of the server', () => {
    const directives = UI_PAGE_CONTENT_SECURITY_POLICY.split('; ')
    expect(directives).toContain('sandbox allow-scripts')
    expect(UI_PAGE_CONTENT_SECURITY_POLICY).not.toContain('allow-same-origin')
    expect(directives).toContain("connect-src 'none'")
    expect(directives).toContain("form-action 'none'")
    expect(directives).toContain("default-src 'none'")
    expect(UI_PAGE_CONTENT_SECURITY_POLICY).not.toMatch(/https?:|\*/)
    expect(directives.filter((directive) => directive.includes("'self'"))).toEqual(["script-src 'unsafe-inline' 'self'"])
  })

  it('answers 404 for unknown sessions, pages, revisions and malformed paths', async () => {
    const page = await createUiPage(sessionDir, { title: 'Chart', blocks: [chart([1])] })
    const dir = spyOn(sessionService, 'getSessionDataDir').mockResolvedValue(sessionDir)

    expect((await serve(`/ui-pages/${sessionId}/${page.pageId}/2`)).status).toBe(404)
    expect((await serve(`/ui-pages/${sessionId}/${'e'.repeat(24)}/1`)).status).toBe(404)
    expect((await serve(`/ui-pages/${sessionId}/${page.pageId}/0`)).status).toBe(404)
    expect((await serve(`/ui-pages/${sessionId}/${page.pageId}`)).status).toBe(404)
    expect((await serve(`/ui-pages/${sessionId}/..%2F..%2Fetc/1`)).status).toBe(404)
    expect((await serve(`/ui-pages/bad%20id/${page.pageId}/1`)).status).toBe(404)
    dir.mockResolvedValue(null)
    expect((await serve(`/ui-pages/${sessionId}/${page.pageId}/1`)).status).toBe(404)
  })

  it('serves only GET and HEAD', async () => {
    expect((await serve(`/ui-pages/${sessionId}/${'e'.repeat(24)}/1`, 'POST')).status).toBe(405)
  })

  it('is blocked for remote browsers while H5 access is off', () => {
    const request = new Request('http://192.168.0.20:3456/ui-pages/s/p/1')
    expect(shouldBlockDisabledH5Access({
      request,
      url: new URL(request.url),
      h5Enabled: false,
      explicitAuthRequired: false,
      context: { clientAddress: '192.168.0.44' },
    })).toBe(true)
  })
})
