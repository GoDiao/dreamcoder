import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { ARTIFACT_CHECK_TOOL_NAME } from '../../tools/ArtifactCheckTool/constants.js'
import { CHOOSE_DESIGN_TEMPLATE_TOOL_NAME } from '../../tools/ChooseDesignTemplateTool/constants.js'
import { USE_DESIGN_SYSTEM_TOOL_NAME } from '../../tools/UseDesignSystemTool/constants.js'
import { readArtifactEntry, type ArtifactManifest } from '../../utils/artifacts.js'
import { browserToolName } from '../../utils/browserControl/common.js'
import { directoryExists } from '../../utils/bundledContent.js'
import { getArtifactWorkRoot } from '../../utils/cwd.js'
import { renderWebCloneSection, resolveWebCloneDir } from '../../utils/webClone.js'
import {
  DESIGN_SYSTEM_DOC_FILE,
  DESIGN_SYSTEM_MANIFEST_FILE,
  DESIGN_SYSTEM_TOKENS_FILE,
  designSystemUsage,
  readDesignSystemCatalog,
  readDesignSystemEntry,
  renderDesignSystemIndex,
} from '../../utils/designSystems.js'
import {
  designTemplateGuidance,
  findDesignTemplate,
  readDesignTemplateCatalog,
  renderDesignTemplateIndex,
} from '../../utils/designTemplates.js'
import { registerBundledSkill } from '../bundledSkills.js'

const navigate = browserToolName('navigate')
const snapshot = browserToolName('snapshot')
const screenshot = browserToolName('screenshot')
const closeTab = browserToolName('close_tab')
const evaluate = browserToolName('evaluate')
const styles = browserToolName('styles')

export const DESIGN_SKILL_PROMPT = `# Design mode

The user wants to design something that is kept as an artifact: a web page or a prototype. Work in five steps. The folder layout, manifest, location rules and the way to show an artifact are in the \`artifacts\` skill; load it with the Skill tool before you write any file.

## Language

Write every question, option, summary and message in the language of the user. Take it from what the user wrote; when the user wrote no words (only /design and a path), use the language of the app or of the user's earlier messages; when you cannot tell, use English. Keep that language for the whole session, and write the content of the artifact in it unless the user asks otherwise.

## 1. Interview

Read the user's message, any referenced artifact and any picked element first. Then ask once with AskUserQuestion, at most 4 questions, only about decisions that change the result: purpose and audience, which kind of artifact, where the content comes from, the look the user wants, and whether to start from a template. Take the questions from what the user gave you, not from a fixed list. Never ask the user to fill in fields or to supply many items in a fixed format. When the material is already enough, do not ask: say your assumptions and start. If the user hands the decision to you ("you decide", "use the example", "anything", "你帮我判断", "用示例", "随便"), treat it as a delegation: decide yourself, say in a few lines what you assumed, and do not ask that question again. Details are in \`interview.md\` in the base directory of this skill.

## 2. Template or scratch

Templates are starting points with a fixed structure and example content. The index below lists them. If one may fit, call ${CHOOSE_DESIGN_TEMPLATE_TOOL_NAME} with 2 to 4 candidates and a one-sentence reason each; the user sees cards with thumbnails and picks one, or picks "start from scratch". The tool copies the chosen template into dc_artifacts/ and returns the path and how to adapt it. If the user does not want a template, or none fits, skip this step and write the artifact yourself.

## 3. Design system

A design system is a folder dc_artifacts/systems/<name>/ with DESIGN.md (tone, type, components) and tokens.css (CSS variables); the artifact links tokens.css and takes every value from var(--*). Skip this step for a template that is marked as having a fixed look. If the user points at a website or at project code whose look they want, extract a system from it. Otherwise, if the look is not already decided, pick one from the library index below and call ${USE_DESIGN_SYSTEM_TOOL_NAME} with its id; the user confirms the copy. The library holds a few starters and styles converted from well-known brands: they are style references, not official assets, so never present them as the brand's own. Extraction and application are in \`design-systems.md\` in the base directory of this skill.

## 4. Make it

Adapt the template or write the page. Keep the user's real content; do not leave the template's example names, numbers or text behind. When the user delegated the content to you, replace the template's example content (names, titles, items, figures, dates) with content that fits the user's purpose; keeping the example data as it is does not count as an answer. Do not copy another website's text, images or trademarks: take layout and style as inspiration only. When the user wants several screens or variants side by side, make a canvas: \`canvas.md\` in the base directory of this skill says how. When the user explicitly asks to clone or reproduce a website, read \`clone.md\` in the base directory of this skill and follow it; do not read it for any other request.

## 5. Check it

Follow \`checks.md\` in the base directory of this skill: ${ARTIFACT_CHECK_TOOL_NAME}, then open the artifact in a new tab and look at it.
`

export const DESIGN_INTERVIEW_REFERENCE = `# Interview

Ask with AskUserQuestion once. Up to 4 questions, each with 2 to 4 options that the user can choose from.

Good questions change what you build:
- Purpose and audience: who reads or uses it, and what should they do afterwards.
- Kind: a page or a prototype of an app screen.
- Content: the user supplies it, you draft it, or it comes from a file or a project folder.
- Look: a mood, a reference the user likes, or "no preference".
- Template: start from one of the templates or not.

Rules:
- Write each question from the user's own words and material. A question whose answer the user already gave is a wasted turn.
- Put your recommended option first and say why in its description.
- If the user's request is already specific, skip the interview, state your assumptions in two or three lines and start.
- After the answers, do not ask again unless something blocks you.
- Ask and answer in the language of the user. With no words from the user (only /design and a path), use the language of the app or of the earlier messages, and English when unsure.
- Delegation: "you decide", "use the example", "anything", "你帮我判断", "用示例", "随便" all mean the user gives the decision to you. Do not ask it again. Decide, state your assumptions in two or three lines, and go on.
- When the user delegates content and you start from a template, replace the template's example content (names, titles, items, numbers, dates) with content that fits the purpose and audience. Leaving the example data as it is, or changing only a name, is not acceptable.
- Never make the user fill in a form. Do not ask for a name, a title or a list of items one field at a time, and do not ask the user to provide many items in a fixed format such as "column | title | label | points | owner". When you need content, ask only where it comes from: a file the user gives you, example content you write, or a few items the user tells you in their own words. You complete the rest.
`

export const DESIGN_SYSTEMS_REFERENCE = `# Design systems: apply and extract

## Apply a system

1. Get the system into this project: ${USE_DESIGN_SYSTEM_TOOL_NAME} for one from the library, or a folder you wrote yourself in dc_artifacts/systems/<name>/. The folder holds ${DESIGN_SYSTEM_MANIFEST_FILE}, ${DESIGN_SYSTEM_DOC_FILE} and ${DESIGN_SYSTEM_TOKENS_FILE}, and evidence.md when it was extracted.
2. Read ${DESIGN_SYSTEM_DOC_FILE} fully before you touch the page: it says what the style is for, how type, spacing and components behave, and what to avoid.
3. In the entry HTML add <link rel="stylesheet" href="../systems/<name>/${DESIGN_SYSTEM_TOKENS_FILE}"> with a relative path (one more ../ for each folder the entry sits below the artifact folder). Do not paste the tokens into the page and do not link anything outside dc_artifacts/.
4. Take every color, font, size, space, radius, shadow, duration and container width from var(--*). The variables are: --bg, --surface, --surface-warm, --fg, --fg-2, --muted, --meta, --border, --border-soft, --accent, --accent-on, --accent-hover, --accent-active, --success, --warn, --danger, --font-display, --font-body, --font-mono, --text-xs to --text-4xl, --leading-body, --leading-tight, --tracking-display, --space-1 to --space-12, --section-y-desktop, --section-y-tablet, --section-y-phone, --radius-sm, --radius-md, --radius-lg, --radius-pill, --elev-flat, --elev-ring, --elev-raised, --focus-ring, --motion-fast, --motion-base, --ease-standard, --container-max and --container-gutter-desktop, -tablet and -phone. A converted system may define more; read ${DESIGN_SYSTEM_TOKENS_FILE} to see what exists. If you need a value the system lacks, add a variable to the page's own :root with a name that does not clash, and say so.
5. When you start from a template, replace the template's own colors, fonts and sizes with the matching variables instead of keeping both.
6. Set "designSystem": "systems/<name>" in artifact.json.
7. Run ${ARTIFACT_CHECK_TOOL_NAME}: it fails when the system files are missing or the page does not link ${DESIGN_SYSTEM_TOKENS_FILE}. Then look for any color or font that is still a literal in the page.

If the system was copied from the library, edit the copy only when the user asks for a different look; the library itself never changes.

## Extract a system from a website

Do this only when the user names a site or a project whose look they want to reuse. The system is the user's reference for their own work: take the look, not the content.

1. Open the site with \`${navigate}\` in a new tab and take a \`${snapshot}\`. If the page is a verification wall (a challenge, a login, a consent screen that hides the page), stop and tell the user; do not bypass it.
2. Measure before you write. Use \`${styles}\` on the elements that carry the look (page body, a heading, body text, a card, a primary button, a link, an input) and \`${evaluate}\` for what \`${styles}\` cannot give: the CSS variables declared on :root, the font families in use, the most frequent colors. Take values from the page as the browser computes them.
3. Decide the roles from what you measured: the page background, the card surface, text, secondary text, border and the one accent are the ones that matter most. Do not invent a value; when something was not measured, leave the variable out or take it from the nearest measured one and note that in evidence.md.
4. Write dc_artifacts/systems/<name>/ with:
   - ${DESIGN_SYSTEM_MANIFEST_FILE}: {"version": 1, "name": "<readable name>", "source": "extracted", "license": "unspecified", "author": "Extracted by an agent from <url>"}.
   - ${DESIGN_SYSTEM_TOKENS_FILE}: one :root block with the variable names listed above, values from the page.
   - ${DESIGN_SYSTEM_DOC_FILE}: written in your own words: atmosphere, color roles, type, spacing, components, motion, voice, anti-patterns. Quote values, not the site's text.
   - evidence.md: for every value in ${DESIGN_SYSTEM_TOKENS_FILE} one line with the variable, the value, and where it came from (the element or selector, the tool and the page URL).
5. You may download the site's logo, images and font files you need into the folder, for example under assets/ (the website clone scripts in clone.md, such as asset-harvest.mjs, do this with the app's browser). In evidence.md write the address each file came from. Write DESIGN.md in your own words; do not copy the site's marketing text.

## Extract a system from project code

Read the project's CSS variables, Tailwind or theme config and a few components. The same files and the same rule apply: values come from the code, and evidence.md names the file and line of each one.
`

export const DESIGN_CANVAS_REFERENCE = `# Canvas

A canvas shows several boards side by side so the user can compare screens or variants and move them around. The manifest, the fixed index.html and the rules for board files are in the \`artifacts\` skill; follow them exactly. This file is about designing one.

## When

- A flow with several screens, a set of options for the same screen, or a before and after: use a canvas.
- One page: do not.

## Boards

- One board is one screen or one variant. Give each a short title the user will recognise, and an id in lowercase letters.
- Size a board like the real thing: a phone screen about 390 by 844, a tablet about 820 by 1180, a desktop page about 1280 by 800 (taller if the page scrolls). Boards of one flow share a size.
- The canvas does not grow a board to fit its page. Measure the real content height before you set \`height\`: write the board file, then run \`document.documentElement.scrollHeight\` on it with the browser tools (open the board file on its own with \`${navigate}\`), and use that number. A guessed height leaves an empty block at the bottom or cuts the page off.
- Clicks, typing and hover aimed at a board's page do nothing on the canvas until that board is in interaction mode: click its Interact button in the board's title bar first (details in the \`artifacts\` skill), or open the board file on its own tab to test it.
- Lay boards out in reading order: a flow runs left to right with 80 to 120 pixels between boards; variants of one screen are stacked in rows. No two boards overlap. The first board starts at 0, 0.
- Every board links the same design system tokens (see design-systems.md) so the boards look like one product. Use relative paths from the board file, one folder up at most, to the systems folder.
- A board is a complete page. It must work on its own, because the user can open one board in a tab and export it.

## Working on it

- Add a board by writing its file and adding its entry to boards; change a board by editing its file. Do not rewrite the whole manifest when you only add a board.
- The user may have moved or resized boards. Read artifact.json before you edit it and keep the positions you find.
- ${ARTIFACT_CHECK_TOOL_NAME} checks the entry file, every board file and what each board references. Run it after every change.
- To look at the result open the artifact folder with \`${navigate}\` in a new tab and take a \`${snapshot}\` or a \`${screenshot}\`. A snapshot splits its element budget between boards: read a board that shows no elements with \`region\` set to the iframe id in its section header.
`

export const DESIGN_CLONE_REFERENCE = `# Website clone

Use this only when the user explicitly asks to clone or reproduce a website. The scripts directory and the command prefix are in the prompt of this skill (Website clone tools). The scripts need the DreamCoder desktop app: it provides the browser they drive. If a script says there is no browser, tell the user that cloning needs the desktop app and stop.

## Stance

A clone is a faithful copy unless the user says otherwise. Bring in the real fonts, images, colors and behavior of the site, including pictures, fonts and media downloaded to local files. Do not water it down because the site is commercial or has copyrighted content; instead write what must be replaced before the page is published into REPLACE.md. Only when the user says they want their own site, or their own brand on it, make a looser visual copy and replace the content.

## Where things go

Everything lives in one artifact folder, dc_artifacts/<name>/, made as the artifacts skill describes (kind page, entry index.html). Put the working files in it: NOTES.md, RECON/ (measurements and screenshots), assets/, CLONE_REPORT.md, CLONE_AUDIT.md and REPLACE.md. A page can only read files inside dc_artifacts/, so every file the clone needs is in that folder. Run every script with the artifact folder as the working directory, or pass folders inside it, and refer to files with relative paths.

## Steps

1. Start the folder: init-clone.mjs <slug> --url <address> --in-place creates NOTES.md and RECON/screenshots/.
2. Look for the real source first. If the user gave a repository, or the site is a plain static page that you can read from its own address, use that source. Do not trust analysis text written by another model: its code blocks are guesses until checked against the real source.
3. Measure the original. All of these take --url and --out:
   - recon-site.mjs --url <address> --out RECON --label original: frameworks, resources, structure, the computed colors of the main regions, the font rules, screenshots at three widths, console errors.
   - asset-harvest.mjs --url <address> --out assets --recon RECON/original-recon.json: scrolls the page in the app's browser and downloads the images, fonts and media it really used, writes assets/fonts/fonts.css with local font rules and assets/asset-manifest.json (original address to local path).
   - network-capture.mjs (data requests, for pages that load content from an API), route-crawl.mjs (internal pages, each with a screenshot), interaction-probe.mjs (hover, click and scroll states), sourcemap-hunt.mjs --recon RECON/original-recon.json --out RECON/sourcemaps (source maps of the page's scripts).
   - mirror-site.mjs --url <address> --out <folder>: for a static build (Astro, Vite static output, Hugo) it copies the deployed files of the site in full, which is the real source of such a site.
4. Rate the difficulty before you promise anything: simple static page, content site built with a framework, data-driven page, many pages, heavy WebGL or canvas. Write the rating, the chosen mode and what you will not copy into NOTES.md.
5. Choose the path from what you measured: a static site is copied and edited; a framework site is rebuilt from its structure; a data-driven page gets its API answers saved as local fixtures; a site with many pages is built from one template per page type; a WebGL or canvas site needs its real source or a frame capture before you rebuild it.
6. Build the page in the artifact folder.
   - Fonts: use the real font files from assets/fonts/ through fonts.css, and copy the font-family values from recon-site's output. A system font stack in place of the site's fonts is a failure.
   - Images: use the downloaded files; replace each reference by looking it up in asset-manifest.json. A gradient or a drawn box in place of a picture is a failure unless the download failed, and then NOTES.md says which picture.
   - Colors: copy the computed values from the recon file. Do not judge by eye.
   - Scrolling: if the recon shows a smooth-scroll library, scroll snapping, sticky headers or scroll-triggered animation, reproduce them.
   - Remove analytics, tracking pixels and heat-map scripts.
7. Make the paths work in the app: run od-preview-rewrite.mjs --project <artifact folder>. The app serves dc_artifacts/ as its root, so an address like /assets/x that was right on the original site would point to the wrong folder; the script rewrites such root addresses in HTML, CSS and SVG to relative paths. Do this after every change that adds pages or assets.
8. Check it in the browser: open the artifact with the browser tools as the checks reference describes, read the console for errors, and compare screenshots with the original. Say what you could not verify.
9. Measure the clone with the same scripts (recon-site.mjs with --label clone on the address of the open artifact, route-crawl.mjs, interaction-probe.mjs), then compare-recon.mjs, visual-diff.mjs and audit-clone.mjs --project <artifact folder> --recon RECON/original-recon.json --strict. The audit exits with a failure when fonts are not self-hosted, pictures are not local or colors differ: fix and run it again before you hand over.
10. Write REPLACE.md: every trademark, text, picture and font that must be replaced before the user publishes the clone as their own, with the file and the original address. Record the license of the source in NOTES.md when you know it; a public page is not a free license.

## Rules for the scripts

- A script asks the app for a browser. The first time it opens an external site the user is asked to allow it; if the user refuses, stop and say so.
- If the page shows a human-verification wall or a login, stop and tell the user. Do not try to get around it. Cloning with the user's logged-in state is not supported: the app's browser starts clean.
- --wait is an extra pause after the page loaded; it is not a timeout. Use --navigation-timeout for a slow page. Do not retry the same error with a longer wait.
- If a script reports an error you cannot explain, show the user the message instead of working around it with guesses.

## What a clone can and cannot do

It can reproduce marketing pages, company sites, content sites and animated pages whose source you can get. It simplifies data-driven content, long scroll stories, responsive breakpoints, WebGL and embeds. It does not clone logins, payments, orders, search, permissions or server logic: build a front-end stand-in that shows the states and say so.
`

export const DESIGN_CHECKS_REFERENCE = `# Check loop

After you change an artifact:

1. Run ${ARTIFACT_CHECK_TOOL_NAME} on the artifact folder. It checks the manifest, the entry file and every local file the page references. Fix every problem it lists and run it again.
2. Open the artifact with \`${navigate}\` using the artifact folder as the url and \`newTab: true\`. Reuse the tab id from the result with \`tabId\` for later looks, and close it with \`${closeTab}\` when you are done.
3. Look at it with \`${screenshot}\` and read it with \`${snapshot}\`. Check that the content is the user's, that text fits, that nothing is cut off, and that the sections read in order.
4. Fix what is wrong and look once more. One careful look after a fix is enough: do not render at many widths or score the page in rounds.

Tell the user what you made, which template it came from if any, and what you assumed.
`

async function artifactFolderIn(args: string): Promise<string | null> {
  const trimmed = args.trim()
  const candidates = trimmed ? [trimmed, ...trimmed.split(/\s+/)] : []
  for (const token of candidates) {
    const candidate = isAbsolute(token) ? token : resolve(getArtifactWorkRoot(), token)
    if (await directoryExists(candidate)) return candidate
  }
  return null
}

async function designSystemIndexSection(): Promise<string> {
  try {
    const catalog = await readDesignSystemCatalog()
    return `## Design system library index\n\n${renderDesignSystemIndex(catalog.systems)}`
  } catch {
    return '## Design system library index\n\nThe design system library is not available. Skip the library; you can still extract a system from a website or project code.'
  }
}

async function designSystemOfArtifact(artifactFolder: string, manifest: ArtifactManifest | null): Promise<string | null> {
  const reference = manifest?.designSystem
  if (!reference) return null
  const name = reference.split('/').pop() ?? reference
  return designSystemUsage(name, join(dirname(artifactFolder), reference))
}

async function designSystemOfFolder(folder: string): Promise<string | null> {
  const entry = await readDesignSystemEntry(dirname(folder), basename(folder))
  return entry ? designSystemUsage(entry.name, entry.dir) : null
}

async function templateSection(args: string): Promise<string[]> {
  const folder = args ? await artifactFolderIn(args) : null
  const manifest = folder ? (await readArtifactEntry(dirname(folder), basename(folder)))?.manifest ?? null : null
  const templateId = manifest?.template?.id
  const used = templateId ? await findDesignTemplate(templateId).catch(() => null) : null
  const system = folder ? (await designSystemOfArtifact(folder, manifest)) ?? (await designSystemOfFolder(folder)) : null
  const systemPart = system ? [`## Design system of the artifact\n\nThe user chose this design system. Skip the choice in step 3 and apply it as \`design-systems.md\` describes.\n${system}`] : [await designSystemIndexSection()]
  if (folder && used) {
    return [`## Artifact to design\n\nThe user already created ${folder} from a template. Skip step 2.\n${designTemplateGuidance(used)}`, ...systemPart]
  }
  try {
    const catalog = await readDesignTemplateCatalog()
    return [`## Template index\n\n${renderDesignTemplateIndex(catalog.templates)}`, ...systemPart]
  } catch {
    return ['## Template index\n\nThe template catalog is not available. Skip step 2 and write the artifact yourself.', ...systemPart]
  }
}

export function registerDesignSkill(): void {
  registerBundledSkill({
    name: 'design',
    description:
      'Design mode: interview the user, optionally start from a bundled template, then build and check a page or prototype as an artifact.',
    whenToUse:
      'Use when the user wants to design a page or a prototype and keep it as an artifact, or runs /design. Not for a quick chart or table (use ShowUI).',
    argumentHint: '[artifact folder or request]',
    userInvocable: true,
    files: {
      'interview.md': DESIGN_INTERVIEW_REFERENCE,
      'design-systems.md': DESIGN_SYSTEMS_REFERENCE,
      'canvas.md': DESIGN_CANVAS_REFERENCE,
      'clone.md': DESIGN_CLONE_REFERENCE,
      'checks.md': DESIGN_CHECKS_REFERENCE,
    },
    async getPromptForCommand(args) {
      const parts = [DESIGN_SKILL_PROMPT, ...(await templateSection(args)), renderWebCloneSection(await resolveWebCloneDir().catch(() => null))]
      if (args) parts.push(`## User Request\n\n${args}`)
      return [{ type: 'text', text: parts.join('\n') }]
    },
  })
}
