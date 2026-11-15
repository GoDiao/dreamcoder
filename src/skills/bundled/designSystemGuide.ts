import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { ARTIFACT_CHECK_TOOL_NAME } from '../../tools/ArtifactCheckTool/constants.js'
import { USE_DESIGN_SYSTEM_TOOL_NAME } from '../../tools/UseDesignSystemTool/constants.js'
import type { ArtifactKind, ArtifactManifest } from '../../utils/artifacts.js'
import { browserToolName } from '../../utils/browserControl/common.js'
import { directoryExists } from '../../utils/bundledContent.js'
import { getArtifactWorkRoot } from '../../utils/cwd.js'
import { DECK_STYLESHEET_FILE } from '../../utils/deck.js'
import {
  DESIGN_SYSTEM_DOC_FILE,
  DESIGN_SYSTEM_MANIFEST_FILE,
  DESIGN_SYSTEM_TOKENS_FILE,
  designSystemUsage,
  readDesignSystemCatalog,
  readDesignSystemEntry,
  renderDesignSystemIndex,
} from '../../utils/designSystems.js'

const navigate = browserToolName('navigate')
const snapshot = browserToolName('snapshot')
const evaluate = browserToolName('evaluate')
const styles = browserToolName('styles')

const GET_SYSTEM = `Get the system into this project: ${USE_DESIGN_SYSTEM_TOOL_NAME} for one from the library, or a folder you wrote yourself in dc_artifacts/systems/<name>/. The folder holds ${DESIGN_SYSTEM_MANIFEST_FILE}, ${DESIGN_SYSTEM_DOC_FILE} and ${DESIGN_SYSTEM_TOKENS_FILE}, and evidence.md when it was extracted.`
const VARIABLES = `--bg, --surface, --surface-warm, --fg, --fg-2, --muted, --meta, --border, --border-soft, --accent, --accent-on, --accent-hover, --accent-active, --success, --warn, --danger, --font-display, --font-body, --font-mono, --text-xs to --text-4xl, --leading-body, --leading-tight, --tracking-display, --space-1 to --space-12, --section-y-desktop, --section-y-tablet, --section-y-phone, --radius-sm, --radius-md, --radius-lg, --radius-pill, --elev-flat, --elev-ring, --elev-raised, --focus-ring, --motion-fast, --motion-base, --ease-standard, --container-max and --container-gutter-desktop, -tablet and -phone. A converted system may define more; read ${DESIGN_SYSTEM_TOKENS_FILE} to see what exists.`
const LIBRARY_COPY = 'If the system was copied from the library, edit the copy only when the user asks for a different look; the library itself never changes.'

const APPLY_TO_PAGE = `## Apply a system

1. ${GET_SYSTEM}
2. Read ${DESIGN_SYSTEM_DOC_FILE} fully before you touch the page: it says what the style is for, how type, spacing and components behave, and what to avoid.
3. In the entry HTML add <link rel="stylesheet" href="../systems/<name>/${DESIGN_SYSTEM_TOKENS_FILE}"> with a relative path (one more ../ for each folder the entry sits below the artifact folder). Do not paste the tokens into the page and do not link anything outside dc_artifacts/.
4. Take every color, font, size, space, radius, shadow, duration and container width from var(--*). The variables are: ${VARIABLES} If you need a value the system lacks, add a variable to the page's own :root with a name that does not clash, and say so.
5. When you start from a template, replace the template's own colors, fonts and sizes with the matching variables instead of keeping both.
6. Set "designSystem": "systems/<name>" in artifact.json.
7. Run ${ARTIFACT_CHECK_TOOL_NAME}: it fails when the system files are missing or the page does not link ${DESIGN_SYSTEM_TOKENS_FILE}. Then look for any color or font that is still a literal in the page.

${LIBRARY_COPY}`

const APPLY_TO_DECK = `## Apply a system to a deck

1. ${GET_SYSTEM}
2. Read ${DESIGN_SYSTEM_DOC_FILE} fully before you write ${DECK_STYLESHEET_FILE}: it says what the style is for, how type and components behave, and what to avoid.
3. Set "designSystem": "systems/<name>" in artifact.json. The app then loads ${DESIGN_SYSTEM_TOKENS_FILE} before ${DECK_STYLESHEET_FILE}. Do not edit index.html, do not add a <link> for the tokens and do not paste them into ${DECK_STYLESHEET_FILE}.
4. In ${DECK_STYLESHEET_FILE} take every color, font, radius, shadow and duration from var(--*). The variables are: ${VARIABLES}
5. The text sizes, spaces and container widths of a system are made for web pages and are too small for a 1920 by 1080 slide. Define the slide's own sizes as variables in :root of ${DECK_STYLESHEET_FILE} (for example --slide-title, --slide-body, --slide-margin) with the values layout.md asks for, keep the system's ratios between heading and body where you can, and say that you did.
6. Run ${ARTIFACT_CHECK_TOOL_NAME}: it fails when the system files are missing. Then look for any color or font that is still a literal in ${DECK_STYLESHEET_FILE} or in a slide.

${LIBRARY_COPY}`

const EXTRACT = `## Extract a system from a website

Do this only when the user names a site or a project whose look they want to reuse. The system is the user's reference for their own work: take the look, not the content.

1. Open the site with \`${navigate}\` in a new tab and take a \`${snapshot}\`. If the page is a verification wall (a challenge, a login, a consent screen that hides the page), stop and tell the user; do not bypass it.
2. Measure before you write. Use \`${styles}\` on the elements that carry the look (page body, a heading, body text, a card, a primary button, a link, an input) and \`${evaluate}\` for what \`${styles}\` cannot give: the CSS variables declared on :root, the font families in use, the most frequent colors. Take values from the page as the browser computes them.
3. Decide the roles from what you measured: the page background, the card surface, text, secondary text, border and the one accent are the ones that matter most. Do not invent a value; when something was not measured, leave the variable out or take it from the nearest measured one and note that in evidence.md.
4. Write dc_artifacts/systems/<name>/ with:
   - ${DESIGN_SYSTEM_MANIFEST_FILE}: {"version": 1, "name": "<readable name>", "source": "extracted", "license": "unspecified", "author": "Extracted by an agent from <url>"}.
   - ${DESIGN_SYSTEM_TOKENS_FILE}: one :root block with the variable names listed above, values from the page.
   - ${DESIGN_SYSTEM_DOC_FILE}: written in your own words: atmosphere, color roles, type, spacing, components, motion, voice, anti-patterns. Quote values, not the site's text.
   - evidence.md: for every value in ${DESIGN_SYSTEM_TOKENS_FILE} one line with the variable, the value, and where it came from (the element or selector, the tool and the page URL).
5. You may download the site's logo, images and font files you need into the folder, for example under assets/ (the website clone scripts in clone.md of the \`design\` skill, such as asset-harvest.mjs, do this with the app's browser). In evidence.md write the address each file came from. Write DESIGN.md in your own words; do not copy the site's marketing text.

## Extract a system from project code

Read the project's CSS variables, Tailwind or theme config and a few components. The same files and the same rule apply: values come from the code, and evidence.md names the file and line of each one.
`

export function designSystemsReference(kind: ArtifactKind): string {
  return `# Design systems: apply and extract\n\n${kind === 'deck' ? APPLY_TO_DECK : APPLY_TO_PAGE}\n\n${EXTRACT}`
}

export const INTERVIEW_RULES = [
  'Write each question from the user\'s own words and material. A question whose answer the user already gave is a wasted turn.',
  'Put your recommended option first and say why in its description.',
  'If the user\'s request is already specific, skip the interview, state your assumptions in two or three lines and start.',
  'After the answers, do not ask again unless something blocks you.',
] as const

export const DELEGATION_RULE =
  'Delegation: "you decide", "use the example", "anything", "你帮我判断", "用示例", "随便" all mean the user gives the decision to you. Do not ask it again. Decide, state your assumptions in two or three lines, and go on.'

export const NO_FORM_RULE =
  'Never make the user fill in a form. Do not ask for a name, a title or a list of items one field at a time, and do not ask the user to provide many items in a fixed format such as "column | title | label | points | owner". When you need content, ask only where it comes from: a file the user gives you, example content you write, or a few items the user tells you in their own words. You complete the rest.'

export function languageRule(command: string): string {
  return `Ask and answer in the language of the user. With no words from the user (only ${command} and a path), use the language of the app or of the earlier messages, and English when unsure.`
}

export function languageSection(command: string): string {
  return `## Language

Write every question, option, summary and message in the language of the user. Take it from what the user wrote; when the user wrote no words (only ${command} and a path), use the language of the app or of the user's earlier messages; when you cannot tell, use English. Keep that language for the whole session, and write the content of the artifact in it unless the user asks otherwise.`
}

export async function artifactFolderIn(args: string): Promise<string | null> {
  const trimmed = args.trim()
  const candidates = trimmed ? [trimmed, ...trimmed.split(/\s+/)] : []
  for (const token of candidates) {
    const candidate = isAbsolute(token) ? token : resolve(getArtifactWorkRoot(), token)
    if (await directoryExists(candidate)) return candidate
  }
  return null
}

export async function designSystemIndexSection(): Promise<string> {
  try {
    const catalog = await readDesignSystemCatalog()
    return `## Design system library index\n\n${renderDesignSystemIndex(catalog.systems)}`
  } catch {
    return '## Design system library index\n\nThe design system library is not available. Skip the library; you can still extract a system from a website or project code.'
  }
}

export async function chosenDesignSystemUsage(folder: string, manifest: ArtifactManifest | null, kind: ArtifactKind): Promise<string | null> {
  const reference = manifest?.designSystem
  if (reference) return designSystemUsage(reference.split('/').pop() ?? reference, join(dirname(folder), reference), kind)
  const entry = await readDesignSystemEntry(dirname(folder), basename(folder))
  return entry ? designSystemUsage(entry.name, entry.dir, kind) : null
}
