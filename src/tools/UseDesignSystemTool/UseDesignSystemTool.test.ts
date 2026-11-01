import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getIsInteractive, getOriginalCwd, setIsInteractive, setOriginalCwd } from '../../bootstrap/state.js'
import { ALL_AGENT_DISALLOWED_TOOLS } from '../../constants/tools.js'
import { drainSdkEvents } from '../../utils/sdkEventQueue.js'
import { systemRecord, writeSystems } from '../../utils/__tests__/designSystemFixtures.js'
import { USE_DESIGN_SYSTEM_TOOL_NAME } from './constants.js'
import { UseDesignSystemTool } from './UseDesignSystemTool.js'

const originalCwd = getOriginalCwd()
const originalAppRoot = process.env.CLAUDE_APP_ROOT
let root: string
let project: string
let wasInteractive: boolean

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'use-design-system-')))
  project = join(root, 'project')
  await mkdir(project, { recursive: true })
  setOriginalCwd(project)
  await mkdir(join(root, 'Resources', 'bin'), { recursive: true })
  process.env.CLAUDE_APP_ROOT = join(root, 'Resources', 'bin')
  await writeSystems(join(root, 'Resources', 'design-systems'), [systemRecord('alpha'), systemRecord('thin')], { thin: { 'DESIGN.md': '# thin' } })
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
const validate = (input: Record<string, unknown>) => UseDesignSystemTool.validateInput!(input as never, {} as never)
const run = (input: Record<string, unknown>) => UseDesignSystemTool.call(input as never, {} as never, undefined as never, undefined as never)

describe('UseDesignSystem validation and permission', () => {
  test('accepts an id from the library and rejects an unknown one', async () => {
    expect((await validate({ id: 'alpha' })).result).toBe(true)
    const unknown = await validate({ id: 'nope' })
    expect(unknown.result === false && unknown.message).toContain('nope')
  })

  test('rejects with a reason when the library is not available', async () => {
    process.env.CLAUDE_APP_ROOT = join(root, 'elsewhere', 'bin')
    const cwd = process.cwd()
    process.chdir(root)
    try {
      const result = await validate({ id: 'alpha' })
      expect(result.result === false && result.message).toContain('library is not available')
    } finally {
      process.chdir(cwd)
    }
  })

  test('asks the user with the name and the destination, and is excluded from sub-agents', async () => {
    const permission = await UseDesignSystemTool.checkPermissions({ id: 'alpha' } as never, {} as never)
    expect(permission.behavior).toBe('ask')
    expect(permission.behavior === 'ask' && permission.message).toContain('Name of alpha')
    expect(permission.behavior === 'ask' && permission.message).toContain(join(project, 'dc_artifacts', 'systems'))
    expect(ALL_AGENT_DISALLOWED_TOOLS.has(USE_DESIGN_SYSTEM_TOOL_NAME)).toBe(true)
  })
})

describe('UseDesignSystem call', () => {
  test('copies the system into the working directory and says how to apply it', async () => {
    const { data } = await run({ id: 'alpha' })
    expect(data).toMatchObject({ name: 'alpha', path: join(project, 'dc_artifacts', 'systems', 'alpha'), reused: false })
    expect(data.usage).toContain('../systems/alpha/tokens.css')
    expect(data.usage).toContain('"designSystem": "systems/alpha"')
    expect((await readdir(data.path)).sort()).toEqual(['DESIGN.md', 'system.json', 'tokens.css'])
    expect(JSON.parse(await readFile(join(data.path, 'system.json'), 'utf-8'))).toMatchObject({ libraryId: 'alpha', source: 'bundled' })
  })

  test('tells the sidecar something was written, so the session entry refreshes', async () => {
    await run({ id: 'alpha' })
    const events = drainSdkEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      subtype: 'artifact_written',
      path: join(project, 'dc_artifacts', 'systems', 'alpha', 'system.json'),
      tool_name: USE_DESIGN_SYSTEM_TOOL_NAME,
    })
  })

  test('uses the given folder name', async () => {
    const { data } = await run({ id: 'alpha', name: 'brand' })
    expect(data.name).toBe('brand')
    expect(await exists(join(project, 'dc_artifacts', 'systems', 'brand', 'tokens.css'))).toBe(true)
  })

  test('reuses a copy that is already there and words it that way', async () => {
    await run({ id: 'alpha' })
    const { data } = await run({ id: 'alpha' })
    expect(data.reused).toBe(true)
    expect(await readdir(join(project, 'dc_artifacts', 'systems'))).toEqual(['alpha'])
    const block = UseDesignSystemTool.mapToolResultToToolResultBlockParam(data, 'id-1')
    expect(block.content).toContain('already in this project')
  })

  test('reports a failed copy and leaves no folder behind', async () => {
    await expect(run({ id: 'thin' })).rejects.toThrow('Nothing was created')
    expect(await readdir(join(project, 'dc_artifacts', 'systems'))).toEqual([])
    expect(drainSdkEvents()).toEqual([])
  })
})
