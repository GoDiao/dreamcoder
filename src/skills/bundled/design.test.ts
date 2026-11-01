import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import { installDesignSystem } from '../../utils/designSystems.js'
import { createArtifactFromTemplate } from '../../utils/designTemplates.js'
import { systemRecord, writeSystems } from '../../utils/__tests__/designSystemFixtures.js'
import { templateRecord, writeTemplates } from '../../utils/__tests__/designTemplateFixtures.js'
import { clearBundledSkills, getBundledSkillExtractDir, getBundledSkills } from '../bundledSkills.js'
import { initBundledSkills } from './index.js'

const originalAppRoot = process.env.CLAUDE_APP_ROOT
const originalCwd = getOriginalCwd()
let root: string

async function promptOf(args: string): Promise<string> {
  const skill = getBundledSkills().find(command => command.name === 'design')
  if (!skill || skill.type !== 'prompt') throw new Error('design skill not registered')
  const blocks = await skill.getPromptForCommand(args, {} as never)
  return blocks.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'design-skill-')))
  await mkdir(join(root, 'Resources', 'bin'), { recursive: true })
  process.env.CLAUDE_APP_ROOT = join(root, 'Resources', 'bin')
  await writeTemplates(join(root, 'Resources', 'design-templates'), [
    templateRecord('saas', { params: [{ name: 'product_name', type: 'string', required: true }] }),
    templateRecord('fixed-a', { category: 'prototype', acceptsDesignSystem: false }),
  ])
  await writeSystems(join(root, 'Resources', 'design-systems'), [
    systemRecord('starter-one', { origin: 'starter', category: 'Editorial', name: { en: 'One', zh: '一' }, description: { en: 'Warm paper.', zh: '暖纸' } }),
    systemRecord('alpha', { category: 'Fintech' }),
  ])
  setOriginalCwd(join(root, 'project'))
  clearBundledSkills()
  initBundledSkills()
})

afterEach(async () => {
  clearBundledSkills()
  setOriginalCwd(originalCwd)
  if (originalAppRoot === undefined) delete process.env.CLAUDE_APP_ROOT
  else process.env.CLAUDE_APP_ROOT = originalAppRoot
  await rm(root, { recursive: true, force: true })
})

describe('design skill', () => {
  it('is registered, user invocable and invocable by the model', () => {
    const skill = getBundledSkills().find(command => command.name === 'design')
    expect(skill).toBeDefined()
    expect(skill?.disableModelInvocation).toBe(false)
    expect(skill?.userInvocable).toBe(true)
  })

  it('walks through interview, template choice, making and checking, and defers layout rules to the artifacts skill', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('AskUserQuestion')
    expect(prompt).toContain('ChooseDesignTemplate')
    expect(prompt).toContain('`artifacts` skill')
    expect(prompt).toContain('checks.md')
    expect(prompt).toContain('interview.md')
    expect(prompt).toContain('ArtifactCheck')
    expect(prompt).toContain('explicitly asks to clone or reproduce a website')
    expect(prompt).not.toContain('not available yet')
    expect(prompt).toContain('five steps')
    expect(prompt).toContain('UseDesignSystem')
    expect(prompt).toContain('design-systems.md')
  })

  it('tells the agent to use the language of the user, to treat delegation as a decision and not to ask for form fields', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('in the language of the user')
    expect(prompt).toContain('use English')
    expect(prompt).toContain('treat it as a delegation')
    expect(prompt).toContain('你帮我判断')
    expect(prompt).toContain('keeping the example data as it is does not count as an answer')
    expect(prompt).toContain('Never ask the user to fill in fields')
    const interview = await readFile(join(getBundledSkillExtractDir('design'), 'interview.md'), 'utf-8')
    expect(interview).toContain('language of the user')
    expect(interview).toContain('用示例')
    expect(interview).toContain('Leaving the example data as it is, or changing only a name, is not acceptable')
    expect(interview).toContain('Never make the user fill in a form')
    expect(interview).toContain('column | title | label | points | owner')
    expect(interview).toContain('where it comes from')
  })

  it('lists the bundled templates in the prompt, with whether they take a design system', async () => {
    const prompt = await promptOf('make a launch page')
    expect(prompt).toContain('## Template index')
    expect(prompt).toContain('- saas (web, desktop, marketing): Title of saas. d')
    expect(prompt).toContain('Takes a design system. Inputs: product_name*.')
    expect(prompt).toContain('- fixed-a (prototype, desktop, marketing): Title of fixed-a. d')
    expect(prompt).toContain('Fixed look, no design system.')
    expect(prompt).toContain('## User Request\n\nmake a launch page')
  })

  it('lists the design system library in the prompt, starters first', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('## Design system library index')
    expect(prompt.indexOf('### DreamCoder starters')).toBeLessThan(prompt.indexOf('### Fintech'))
    expect(prompt).toContain('- starter-one (One): Warm paper.')
    expect(prompt).toContain('- alpha (Name of alpha): Description of alpha.')
    expect(prompt).toContain('not official assets')
  })

  it('extracts the reference files and points at them', async () => {
    await promptOf('')
    const base = getBundledSkillExtractDir('design')
    expect(await readFile(join(base, 'interview.md'), 'utf-8')).toContain('AskUserQuestion')
    const checks = await readFile(join(base, 'checks.md'), 'utf-8')
    expect(checks).toContain('ArtifactCheck')
    expect(checks).toContain('`mcp__dreamcoder-browser__navigate`')
    expect(checks).toContain('newTab: true')
    expect(checks).toContain('`mcp__dreamcoder-browser__close_tab`')
    expect(checks).toContain('`mcp__dreamcoder-browser__screenshot`')
  })

  it('points at the canvas reference and extracts it with the other reference files', async () => {
    const prompt = await promptOf('')
    expect(prompt).toContain('`canvas.md`')
    const canvas = await readFile(join(getBundledSkillExtractDir('design'), 'canvas.md'), 'utf-8')
    expect(canvas).toContain('# Canvas')
    expect(canvas).toContain('390 by 844')
    expect(canvas).toContain('ArtifactCheck')
    expect(canvas).toContain('`region`')
    expect(canvas).toContain('Read artifact.json before you edit it')
    expect(canvas).toContain('Measure the real content height before you set `height`')
    expect(canvas).toContain('document.documentElement.scrollHeight')
    expect(canvas).toContain('`mcp__dreamcoder-browser__snapshot`')
    expect(canvas).toContain('until that board is in interaction mode')
    expect(canvas).toContain('click its Interact button')
  })

  it('tells where the clone scripts are and how to run them, and to read the clone reference only on request', async () => {
    process.env.CLAUDE_APP_ROOT = join(root, 'Resources', 'bin')
    await mkdir(join(root, 'Resources', 'web-clone', 'scripts'), { recursive: true })
    await writeFile(join(root, 'Resources', 'web-clone', 'scripts', 'recon-site.mjs'), '')
    const prompt = await promptOf('')
    const webClone = join(root, 'Resources', 'web-clone').replaceAll('\\', '/')
    expect(prompt).toContain('## Website clone tools')
    expect(prompt).toContain(`Scripts directory: ${webClone}/scripts`)
    expect(prompt).toContain(`BUN_BE_BUN=1 "${process.execPath}" "${webClone}/scripts/<script>.mjs"`)
    expect(prompt).toContain('only when the user explicitly asks to clone')
  })

  it('says cloning is not available when the scripts are missing', async () => {
    process.env.CLAUDE_APP_ROOT = join(root, 'elsewhere', 'bin')
    const cwd = process.cwd()
    process.chdir(root)
    try {
      const prompt = await promptOf('')
      expect(prompt).toContain('website clone scripts are not available in this build')
      expect(prompt).not.toContain('Scripts directory')
    } finally {
      process.chdir(cwd)
    }
  })

  it('has a clone reference that follows the faithful stance, the paths of the app and the verification gates', async () => {
    await promptOf('')
    const guide = await readFile(join(getBundledSkillExtractDir('design'), 'clone.md'), 'utf-8')
    expect(guide).toContain('explicitly asks to clone or reproduce a website')
    expect(guide).toContain('A clone is a faithful copy')
    expect(guide).toContain('REPLACE.md')
    expect(guide).toContain('NOTES.md')
    for (const script of ['init-clone.mjs', 'recon-site.mjs', 'asset-harvest.mjs', 'mirror-site.mjs', 'route-crawl.mjs', 'interaction-probe.mjs', 'network-capture.mjs', 'compare-recon.mjs', 'visual-diff.mjs', 'audit-clone.mjs', 'od-preview-rewrite.mjs']) {
      expect(guide).toContain(script)
    }
    expect(guide).toContain('dc_artifacts/ as its root')
    expect(guide).toContain('--strict')
    expect(guide).toContain('The scripts need the DreamCoder desktop app')
    expect(guide).toContain('Do not try to get around it')
    expect(guide).toContain('the user is asked to allow it')
  })

  it('lets a design system extraction download the logo, images and fonts and record their source, without the old restrictions', async () => {
    await promptOf('')
    const guide = await readFile(join(getBundledSkillExtractDir('design'), 'design-systems.md'), 'utf-8')
    expect(guide).toContain("You may download the site's logo, images and font files")
    expect(guide).toContain('write the address each file came from')
    expect(guide).not.toContain('Do not copy the site')
    expect(guide).not.toContain('may differ from the brand')
  })

  it('explains how to apply a system and how to extract one from measurements', async () => {
    await promptOf('')
    const guide = await readFile(join(getBundledSkillExtractDir('design'), 'design-systems.md'), 'utf-8')
    expect(guide).toContain('UseDesignSystem')
    expect(guide).toContain('<link rel="stylesheet" href="../systems/<name>/tokens.css">')
    expect(guide).toContain('var(--*)')
    expect(guide).toContain('"designSystem": "systems/<name>"')
    expect(guide).toContain('ArtifactCheck')
    expect(guide).toContain('`mcp__dreamcoder-browser__styles`')
    expect(guide).toContain('`mcp__dreamcoder-browser__evaluate`')
    expect(guide).toContain('evidence.md')
    expect(guide).toContain('"source": "extracted"')
    expect(guide).toContain('do not bypass it')
  })

  it('names the system the artifact was created with and skips the library index', async () => {
    const created = await createArtifactFromTemplate({
      templateId: 'saas',
      artifactsDir: join(root, 'project', 'dc_artifacts'),
      templatesDir: join(root, 'Resources', 'design-templates'),
      designSystemId: 'alpha',
      systemsDir: join(root, 'Resources', 'design-systems'),
    })
    const prompt = await promptOf(created.dir)
    expect(prompt).toContain('## Design system of the artifact')
    expect(prompt).toContain(join(root, 'project', 'dc_artifacts', 'systems', 'alpha'))
    expect(prompt).toContain('../systems/alpha/tokens.css')
    expect(prompt).not.toContain('## Design system library index')
  })

  it('names the system when the argument is a system folder the user picked for a design from scratch', async () => {
    const installed = await installDesignSystem({
      systemId: 'alpha',
      artifactsDir: join(root, 'project', 'dc_artifacts'),
      systemsDir: join(root, 'Resources', 'design-systems'),
    })
    const prompt = await promptOf(installed.dir)
    expect(prompt).toContain('## Design system of the artifact')
    expect(prompt).toContain('../systems/alpha/tokens.css')
    expect(prompt).toContain('## Template index')
    expect(prompt).not.toContain('## Design system library index')
  })

  it('tells the agent the library is missing but extraction still works', async () => {
    process.env.CLAUDE_APP_ROOT = join(root, 'elsewhere', 'bin')
    const cwd = process.cwd()
    process.chdir(root)
    try {
      expect(await promptOf('')).toContain('The design system library is not available')
    } finally {
      process.chdir(cwd)
    }
  })

  it('gives the template guidance instead of the index when the argument is an artifact made from a template', async () => {
    const created = await createArtifactFromTemplate({
      templateId: 'fixed-a',
      artifactsDir: join(root, 'project', 'dc_artifacts'),
      templatesDir: join(root, 'Resources', 'design-templates'),
    })
    const prompt = await promptOf(created.dir)
    expect(prompt).toContain('## Artifact to design')
    expect(prompt).toContain(created.dir)
    expect(prompt).toContain('Skip step 2')
    expect(prompt).toContain('How to adapt it (English): keep')
    expect(prompt).toContain('does not take another design system')
    expect(prompt).not.toContain('## Template index')
  })

  it('finds an artifact folder whose path contains spaces when the whole argument is the path', async () => {
    const created = await createArtifactFromTemplate({
      templateId: 'fixed-a',
      artifactsDir: join(root, 'My Projects', 'dc_artifacts'),
      templatesDir: join(root, 'Resources', 'design-templates'),
    })
    const prompt = await promptOf(created.dir)
    expect(prompt).toContain('## Artifact to design')
    expect(prompt).toContain('Skip step 2')
    expect(prompt).not.toContain('## Template index')
  })

  it('falls back to the index when the argument is a folder that is not a template artifact', async () => {
    await mkdir(join(root, 'project', 'plain'), { recursive: true })
    expect(await promptOf(join(root, 'project', 'plain'))).toContain('## Template index')
  })

  it('tells the agent to write the artifact itself when the catalog is missing', async () => {
    process.env.CLAUDE_APP_ROOT = join(root, 'elsewhere', 'bin')
    const cwd = process.cwd()
    process.chdir(root)
    try {
      expect(await promptOf('')).toContain('The template catalog is not available')
    } finally {
      process.chdir(cwd)
    }
  })
})
