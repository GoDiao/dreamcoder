import { basename, dirname } from 'node:path'
import { ARTIFACT_CHECK_TOOL_NAME } from '../../tools/ArtifactCheckTool/constants.js'
import { USE_DESIGN_SYSTEM_TOOL_NAME } from '../../tools/UseDesignSystemTool/constants.js'
import { readArtifactEntry } from '../../utils/artifacts.js'
import { browserToolName } from '../../utils/browserControl/common.js'
import { DECK_ENTRY_HTML, DECK_HEIGHT, DECK_SLIDE_COUNTER, DECK_SLIDES_COUNTER, DECK_STYLESHEET_FILE, DECK_WIDTH } from '../../utils/deck.js'
import { registerBundledSkill } from '../bundledSkills.js'
import {
  artifactFolderIn,
  chosenDesignSystemUsage,
  DELEGATION_RULE,
  designSystemIndexSection,
  designSystemsReference,
  INTERVIEW_RULES,
  languageRule,
  languageSection,
  NO_FORM_RULE,
} from './designSystemGuide.js'

const navigate = browserToolName('navigate')
const snapshot = browserToolName('snapshot')
const screenshot = browserToolName('screenshot')
const closeTab = browserToolName('close_tab')
const evaluate = browserToolName('evaluate')

const FRAME = `${DECK_WIDTH} by ${DECK_HEIGHT}`

export const SLIDES_SKILL_PROMPT = `# Slides

The user wants a slide deck that is kept as an artifact: one HTML file per slide, shown by the app on a fixed ${FRAME} stage with paging, an overview and a presentation mode. Work in four steps. Where artifacts live, the manifest and the way to show an artifact are in the \`artifacts\` skill; load it with the Skill tool before you write any file. The reference files named below are in the base directory of this skill; read each one when its step comes.

For a web page or a prototype use the \`design\` skill instead of this one.

${languageSection('/slides')}

## 1. Interview

Read the user's message and any material they gave first. Then ask once with AskUserQuestion, at most 4 questions, only about decisions that change the deck: whether a speaker presents it or people read it on their own, about how many slides, where the content comes from, and the look. When the material is already enough, do not ask: say your assumptions and start. If the user hands a decision to you ("you decide", "anything", "你帮我判断", "随便"), treat it as a delegation: decide yourself, say in a few lines what you assumed, and do not ask that question again. Details are in \`interview.md\`.

## 2. Design system

A design system is a folder dc_artifacts/systems/<name>/ with DESIGN.md (tone, type, components) and tokens.css (CSS variables). A deck uses one by naming it in artifact.json; the app then loads the tokens before ${DECK_STYLESHEET_FILE}. If the user points at a website or at project code whose look they want, extract a system from it. Otherwise, if the look is not already decided, pick one from the library index below and call ${USE_DESIGN_SYSTEM_TOOL_NAME} with its id; the user confirms the copy. The library holds a few starters and styles converted from well-known brands: they are style references, not official assets, so never present them as the brand's own. When the user describes a look of their own, write it into ${DECK_STYLESHEET_FILE} without a system. Applying and extracting are in \`design-systems.md\`.

## 3. Make it

\`format.md\` is the file format. Follow it exactly: the stage shows a placeholder for a slide that does not match it. \`layout.md\` says how to lay a slide out. Work in this order:

1. Write artifact.json, index.html, ${DECK_STYLESHEET_FILE} and the first slide, and list that slide in \`slides\`.
2. Open the deck in a new tab, as the \`artifacts\` skill describes, so the user watches it grow. The tab picks up every later change by itself and stays on the slide the user is looking at.
3. Write the other slides one at a time. Add the id of a slide to \`slides\` in artifact.json in the same step as you write its file: a file that is not listed is not shown.

Use the user's real content. When the user delegated the content to you, write content that fits their purpose and audience; do not fill slides with placeholder text. Do not copy another deck's text, images or trademarks.

## 4. Check it

Follow \`checks.md\`: ${ARTIFACT_CHECK_TOOL_NAME}, then the overflow check in the open tab, then look at the slides.
`

const SLIDES_INTERVIEW_RULES = [...INTERVIEW_RULES, languageRule('/slides'), DELEGATION_RULE, NO_FORM_RULE]

export const SLIDES_INTERVIEW_REFERENCE = `# Interview

Ask with AskUserQuestion once. Up to 4 questions, each with 2 to 4 options that the user can choose from.

Good questions change what you build:
- Use: a speaker presents it to a room, or people read it on their own. A presented deck carries one point and few words on a slide and the speaker says the rest; a deck that is read has to explain itself and can carry more text.
- Length: about how many slides, or how long the talk is. Without an answer, plan about one slide for each minute of a talk.
- Content: the user supplies it, you draft it from a topic, or it comes from a file or a project folder.
- Look: a design system from the library, the look of a site or project the user names, a mood in the user's words, or "no preference".

Rules:
${SLIDES_INTERVIEW_RULES.map(rule => `- ${rule}`).join('\n')}

After the answers, write the outline before any file: one line for each slide with its id and its point. Show it to the user in a few lines and start; do not wait for an approval unless the user asked to see the outline first.
`

export const SLIDES_FORMAT_REFERENCE = `# Deck format

## Files

\`\`\`
dc_artifacts/<name>/
  artifact.json
  index.html        fixed text, loads the app's stage script
  ${DECK_STYLESHEET_FILE}          the styles of every slide
  slides/
    cover.html      one file for each slide
    agenda.html
  embeds/           pages that need a script (optional)
  assets/           images and fonts (optional)
\`\`\`

## artifact.json

\`\`\`json
{ "version": 1, "id": "<new UUID v4>", "kind": "deck", "title": "Quarterly review", "entry": "index.html", "slides": ["cover", "agenda"] }
\`\`\`

- \`slides\` lists the ids of the slides in the order they are shown. The order is stored nowhere else: to reorder, change this list and nothing else.
- The file of a slide is \`slides/<id>.html\`. An id uses letters, digits, \`_\` and \`-\` only, at most 64 characters. Name it after what the slide says (\`cover\`, \`agenda\`, \`pricing\`), not after its position, so that reordering renames nothing.
- A file in \`slides/\` that the list does not name is not shown. To remove a slide, take its id out of the list and delete its file.
- \`title\` names the deck in the app and in the tab.
- \`designSystem\` is optional, see design-systems.md.

## index.html

Always exactly this text:

\`\`\`html
${DECK_ENTRY_HTML}\`\`\`

Never add a stylesheet link, a script or any content to it. The stage script loads ${DECK_STYLESHEET_FILE}, the tokens of the design system and every slide.

## A slide file

\`\`\`html
<section class="slide slide-title">
  <h1>Quarterly review</h1>
  <p class="subtitle">Third quarter, 2026</p>
</section>
\`\`\`

- The file is one \`<section>\` element and nothing before or after it: no doctype, \`<html>\`, \`<head>\`, \`<body>\`, \`<style>\` or \`<script>\`.
- A slide is always ${FRAME} CSS pixels. The stage scales the whole slide to fit the window; it never reflows it. Write every size in px for that frame. Do not use vw, vh or other viewport units and do not write media queries for the window size: the window is not the slide.
- The stage gives the section the size of the frame, \`box-sizing: border-box\`, \`position: relative\` and \`overflow: hidden\`. Everything else is yours: display, padding, background, colors. Without a background the slide is white with black text, whatever the theme of the app.
- Inside the section any HTML and CSS is allowed.
- All style rules are in ${DECK_STYLESHEET_FILE} and select by class. Do not select by \`#id\`, and do not write rules for \`html\`, \`body\` or any class that starts with \`dc-\`: those belong to the stage. A \`style\` attribute for a one-off value is fine.
- Relative paths start at the artifact folder, not at \`slides/\`: write \`assets/chart.png\` and \`embeds/demo.html\`, never \`../assets/chart.png\`. The slide is shown inside index.html, so the browser resolves its paths from there. \`url()\` in ${DECK_STYLESHEET_FILE} has the same base, because that file is in the artifact folder. Opening a slide file on its own breaks its references; that is expected.
- No \`<script>\` and no inline event attributes such as \`onclick\`: a script in a slide never runs. Use CSS for motion (\`@keyframes\`, \`transition\`).
- Content that needs a script, such as a chart drawn by a library or a live demo, goes into an embedded page: a complete HTML file under \`embeds/\` of this artifact, shown with \`<iframe src="embeds/demo.html" class="demo"></iframe>\` and given its width and height in ${DECK_STYLESHEET_FILE}. The embedded page is a normal document: it can run scripts, its own paths are relative to its own file (\`../assets/data.json\`), and every library it loads is a file in the artifact folder.
- Steps: give an element \`class="fragment"\` to make it appear one step at a time in presentation mode, in document order. Outside presentation mode, and in exports, every fragment is visible.
- The name of a slide in references and messages is the text of its first heading (\`h1\` to \`h6\`); without a heading it is the id.
- Fonts load from the web with \`@import\` or \`@font-face\` in ${DECK_STYLESHEET_FILE}, or from files in \`assets/\`. Give a fallback family: without a connection the web font does not load.

## Page numbers

The stage counts the slides in two CSS counters: \`${DECK_SLIDE_COUNTER}\` is the number of the slide, starting at 1 in the order of \`slides\`, and \`${DECK_SLIDES_COUNTER}\` is the number of slides. Write the page number once in ${DECK_STYLESHEET_FILE} and put one empty element into each slide:

\`\`\`css
.page-number::after { content: counter(${DECK_SLIDE_COUNTER}, decimal-leading-zero) " / " counter(${DECK_SLIDES_COUNTER}, decimal-leading-zero); }
\`\`\`

\`\`\`html
<p class="page-number"></p>
\`\`\`

The numbers stay right when a slide is added, removed or moved, in the overview, in the presentation and in every export. Never type a number that depends on the order of the slides into a slide file: no \`03 / 12\`, and no numbered kicker or heading such as \`02 / Architecture\`. Such a number is wrong as soon as the order changes. Number with \`counter(${DECK_SLIDE_COUNTER})\` or leave the number out. Do not reset or increment these two counters yourself.

## Write the HTML the way a browser serializes it

Slide files are meant to be read and written back by the browser's own HTML parser, so write them in the form that parser produces, and a later write changes only what was edited:

- attribute values in double quotes, tag and attribute names in lowercase;
- every element closed with its own end tag, also inside SVG (\`<path d="..."></path>\`, not \`<path d="..." />\`); void HTML elements such as \`<img>\` and \`<br>\` have no end tag and no slash;
- boolean attributes without a value (\`hidden\`, not \`hidden="hidden"\`);
- \`&amp;\`, \`&lt;\` and \`&gt;\` for those three characters in text, and the character itself instead of any other entity (\`é\`, not \`&eacute;\`).
`

export const SLIDES_LAYOUT_REFERENCE = `# Laying out a slide

The frame is ${FRAME} pixels and is seen from across a room or in a small panel. Sizes that look right on a web page are too small here.

## Frame and type

- Keep text and anything that must be read at least 96 px from the left and right edges and 72 px from the top and bottom. Backgrounds, images and decoration may run to the edge.
- Body text is at least 28 px in a deck that is presented and at least 24 px in a deck that is read. Captions, labels and footers are at least 20 px. Titles are 56 to 120 px. Nothing that has to be read is smaller than 20 px.
- Put the sizes into variables at the top of ${DECK_STYLESHEET_FILE} (\`--slide-title\`, \`--slide-body\`, \`--slide-margin-x\`, …) and use them everywhere, so the deck changes in one place.
- Line length: a block of body text is at most about 60 characters wide for Latin text and 30 for Chinese, Japanese or Korean. Make the block narrower instead of letting a line run across the whole slide.
- Text needs clear contrast with what is behind it. Text over a photo gets a solid or shaded area under it.

## One slide, one point

- A slide says one thing. Its title states the point ("Churn fell by a third"), not the topic ("Churn").
- A presented slide has at most about 40 words; a slide that is read has at most about 120. A list has at most 6 items.
- When the content does not fit, split it over two slides or cut words. Do not shrink the type under the sizes above and do not shrink the margins.
- A number that matters is shown large with its unit and one line that says what it means, not inside a paragraph.

## One deck, few layouts

- Decide a small set of slide kinds first and give each a class: for example \`slide-title\`, \`slide-section\`, \`slide-text\`, \`slide-two-columns\`, \`slide-figure\`, \`slide-quote\`, \`slide-closing\`. Every slide uses one of them; two slides of the same kind have the same structure and the same positions for title and body.
- The title sits at the same place on every content slide. So does anything that repeats, such as a footer: the stage adds no element to a slide, so write it into each slide.
- Page numbers are not written into the slides. Put one empty element into each slide and let ${DECK_STYLESHEET_FILE} fill it from the counters \`${DECK_SLIDE_COUNTER}\` and \`${DECK_SLIDES_COUNTER}\` (format.md, Page numbers). Do not type any number that depends on the order of the slides into a slide file, also not as a section number in a kicker or heading: adding, removing or moving a slide would make it wrong.
- Use one accent color for emphasis and keep it for the same meaning through the deck.
- Give every image a width and height in ${DECK_STYLESHEET_FILE} and \`object-fit\` so it cannot push the layout around when it loads.
- Charts and diagrams: draw simple ones in inline SVG or CSS inside the slide; use an embedded page only when a library has to draw it.

## Steps and motion

- Use fragments when the speaker builds an argument step by step. A deck that is read needs none.
- Keep motion short (under half a second) and the same through the deck. Motion must not be needed to understand the slide: an export shows the final state only.
`

export const SLIDES_CHECKS_REFERENCE = `# Check loop

After you add or change slides:

1. Run ${ARTIFACT_CHECK_TOOL_NAME} on the artifact folder. It checks the manifest, the fixed index.html, ${DECK_STYLESHEET_FILE}, every listed slide file (one section, no script, no inline event attribute), every local file a slide, ${DECK_STYLESHEET_FILE} or an embedded page refers to, and slide files that the manifest does not list. Fix every problem it lists and run it again.
2. Open the deck with \`${navigate}\` using the artifact folder as the url and \`newTab: true\`, unless you already opened it; then reuse the tab id with \`tabId\`. The open tab refreshes by itself when files change. Close it with \`${closeTab}\` only when the user no longer needs to see it.
3. Find what leaves the frame: run \`window.__dreamcoderDeck.overflow()\` with \`${evaluate}\`. It returns, for each slide that has one, the elements that reach outside the ${FRAME} frame, with their class, the start of their text and their box in slide pixels. Fix each one by splitting the slide or changing its layout, as layout.md says; decoration that is meant to run off the edge can stay. An empty list does not mean the slides are fine: it does not find elements that overlap each other or text cut off inside a box, and the scroll height of a slide tells you nothing about either. For those you have to look.
4. Look at the slides. A \`${snapshot}\` or \`${screenshot}\` shows only the current slide: go to a slide with \`window.__dreamcoderDeck.goTo('<id>')\` through \`${evaluate}\`, then take a \`${screenshot}\`. \`window.__dreamcoderDeck.state()\` tells you which slide and mode the tab is in. Look at every slide of a short deck; in a long one, look at one slide of each kind, every slide step 3 reported and every slide with an image, a chart or an embedded page. Check that text fits and does not overlap, that nothing is cut off, and that slides of the same kind line up. When you are done, go back to the slide the user was on if you moved away from it.
5. Fix what is wrong and look once more at the slides you changed.

Tell the user what you made, how many slides it has and what you assumed.
`

async function deckSection(args: string): Promise<string[]> {
  const folder = args ? await artifactFolderIn(args) : null
  const manifest = folder ? (await readArtifactEntry(dirname(folder), basename(folder)))?.manifest ?? null : null
  const system = folder ? await chosenDesignSystemUsage(folder, manifest, 'deck') : null
  const systemPart = system
    ? `## Design system of the deck\n\nThe user chose this design system. Skip the choice in step 2 and apply it as \`design-systems.md\` describes.\n${system}`
    : await designSystemIndexSection()
  if (!folder || manifest?.kind !== 'deck') return [systemPart]
  return [
    `## Deck to work on\n\nThe deck ${folder} already exists. Read its artifact.json, ${DECK_STYLESHEET_FILE} and slides before you change anything, keep its layouts and classes, and ask in step 1 only what the deck does not already answer.`,
    systemPart,
  ]
}

export function registerSlidesSkill(): void {
  registerBundledSkill({
    name: 'slides',
    description:
      'Slides: interview the user, then build and check a slide deck as an artifact, with one HTML file per slide on a fixed 1920 by 1080 stage that the app pages, presents and exports.',
    whenToUse:
      'Use when the user wants slides, a deck or a presentation, or runs /slides. Not for a web page or a prototype (use the design skill).',
    argumentHint: '[deck folder or request]',
    userInvocable: true,
    files: {
      'interview.md': SLIDES_INTERVIEW_REFERENCE,
      'format.md': SLIDES_FORMAT_REFERENCE,
      'layout.md': SLIDES_LAYOUT_REFERENCE,
      'design-systems.md': designSystemsReference('deck'),
      'checks.md': SLIDES_CHECKS_REFERENCE,
    },
    async getPromptForCommand(args) {
      const parts = [SLIDES_SKILL_PROMPT, ...(await deckSection(args))]
      if (args) parts.push(`## User Request\n\n${args}`)
      return [{ type: 'text', text: parts.join('\n') }]
    },
  })
}
