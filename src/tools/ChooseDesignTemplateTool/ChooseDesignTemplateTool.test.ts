import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getIsInteractive, getOriginalCwd, setIsInteractive, setOriginalCwd } from '../../bootstrap/state.js'
import { ALL_AGENT_DISALLOWED_TOOLS } from '../../constants/tools.js'
import { drainSdkEvents } from '../../utils/sdkEventQueue.js'
import { templateRecord, writeTemplates } from '../../utils/__tests__/designTemplateFixtures.js'
import { CHOOSE_DESIGN_TEMPLATE_TOOL_NAME } from './constants.js'
import { ChooseDesignTemplateTool } from './ChooseDesignTemplateTool.js'

const originalCwd = getOriginalCwd()
const originalAppRoot = process.env.CLAUDE_APP_ROOT
let root: string
let project: string
let wasInteractive: boolean

const candidates = [
  { id: 'saas', reason: 'a landing page' },
  { id: 'fixed-a', reason: 'a fixed look' },
]

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'choose-template-')))
  project = join(root, 'project')
  await mkdir(project, { recursive: true })
  setOriginalCwd(project)
  await mkdir(join(root, 'Resources', 'bin'), { recursive: true })
  process.env.CLAUDE_APP_ROOT = join(root, 'Resources', 'bin')
  await writeTemplates(join(root, 'Resources', 'design-templates'), [
    templateRecord('saas'),
    templateRecord('fixed-a', { category: 'prototype', acceptsDesignSystem: false }),
    templateRecord('broken'),
  ], { broken: { 'other.html': 'x' } })
  wasInteractive = getIsInteractive()
  setIsInteractive(false)
  drainSdkEvents()
})

afterEach(async () => {
  drainSdkEvents()
  setIsInteractive(wasInteractive)
  setOriginalCwd(originalCwd)
  if (originalAppRoot === undefined) delete process.env.CLAUDE_APP_ROOT
  else process.env.CLAUDE_APP_ROOT = originalAppRoot
  await rm(root, { recursive: true, force: true })
})

const exists = (path: string) => stat(path).then(() => true, () => false)
const validate = (input: Record<string, unknown>) => ChooseDesignTemplateTool.validateInput!(input as never, {} as never)
const run = (input: Record<string, unknown>) => ChooseDesignTemplateTool.call(input as never, {} as never, undefined as never, undefined as never)

describe('ChooseDesignTemplate validation and permission', () => {
  test('accepts templates that are in the catalog', async () => {
    expect((await validate({ candidates })).result).toBe(true)
  })

  test('rejects an unknown id and names it', async () => {
    const result = await validate({ candidates: [candidates[0], { id: 'nope', reason: 'x' }] })
    expect(result.result).toBe(false)
    expect(result.result === false && result.message).toContain('nope')
  })

  test('rejects the same template offered twice', async () => {
    const result = await validate({ candidates: [candidates[0], candidates[0]] })
    expect(result.result).toBe(false)
  })

  test('rejects with a reason when the catalog is not available', async () => {
    process.env.CLAUDE_APP_ROOT = join(root, 'elsewhere', 'bin')
    const cwd = process.cwd()
    process.chdir(root)
    try {
      const result = await validate({ candidates })
      expect(result.result === false && result.message).toContain('catalog is not available')
    } finally {
      process.chdir(cwd)
    }
  })

  test('always asks the user and is excluded from sub-agents', async () => {
    expect((await ChooseDesignTemplateTool.checkPermissions({ candidates } as never, {} as never)).behavior).toBe('ask')
    expect(ChooseDesignTemplateTool.requiresUserInteraction?.()).toBe(true)
    expect(ALL_AGENT_DISALLOWED_TOOLS.has(CHOOSE_DESIGN_TEMPLATE_TOOL_NAME)).toBe(true)
  })
})

describe('ChooseDesignTemplate call', () => {
  test('copies the chosen template into the working directory and returns how to adapt it', async () => {
    const { data } = await run({ candidates, choice: 'saas', name: 'landing', title: 'My landing' })
    expect(data).toMatchObject({ choice: 'saas', name: 'landing', path: join(project, 'dc_artifacts', 'landing') })
    expect(data.guidance).toContain('keep')
    expect(data.guidance).toContain('保留')
    expect(await readFile(join(project, 'dc_artifacts', 'landing', 'index.html'), 'utf-8')).toBe('<h1>saas</h1>')
    expect(JSON.parse(await readFile(join(project, 'dc_artifacts', 'landing', 'artifact.json'), 'utf-8'))).toMatchObject({
      kind: 'page',
      title: 'My landing',
      template: { id: 'saas', commit: 'abc123' },
    })
  })

  test('tells the sidecar the artifact was written, so the lists refresh at once', async () => {
    await run({ candidates, choice: 'saas', name: 'landing' })
    const events = drainSdkEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      subtype: 'artifact_written',
      path: join(project, 'dc_artifacts', 'landing', 'artifact.json'),
      tool_name: CHOOSE_DESIGN_TEMPLATE_TOOL_NAME,
    })
  })

  test('mentions that a template with its own look takes no design system', async () => {
    const { data } = await run({ candidates, choice: 'fixed-a' })
    expect(data.guidance).toContain('does not take another design system')
  })

  test('starting from scratch creates nothing', async () => {
    const { data } = await run({ candidates, choice: 'scratch' })
    expect(data).toEqual({ choice: 'scratch' })
    expect(await exists(join(project, 'dc_artifacts'))).toBe(false)
    expect(drainSdkEvents()).toEqual([])
  })

  test('refuses a missing choice and a template that was not offered', async () => {
    await expect(run({ candidates })).rejects.toThrow('did not choose')
    await expect(run({ candidates, choice: 'broken' })).rejects.toThrow('not one of the offered')
    expect(await exists(join(project, 'dc_artifacts'))).toBe(false)
  })

  test('reports a failed copy and leaves no folder behind', async () => {
    await expect(run({ candidates: [candidates[0], { id: 'broken', reason: 'x' }], choice: 'broken' })).rejects.toThrow('Nothing was created')
    expect(await exists(join(project, 'dc_artifacts', 'broken'))).toBe(false)
  })

  test('words the result for each outcome', () => {
    const scratch = ChooseDesignTemplateTool.mapToolResultToToolResultBlockParam({ choice: 'scratch' }, 'id-1')
    expect(scratch.content).toContain('from scratch')
    const picked = ChooseDesignTemplateTool.mapToolResultToToolResultBlockParam({ choice: 'saas', path: '/p/dc_artifacts/saas', guidance: 'adapt it' }, 'id-2')
    expect(picked.content).toContain('/p/dc_artifacts/saas')
    expect(picked.content).toContain('adapt it')
  })
})
