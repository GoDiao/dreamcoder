import { ARTIFACT_CHECK_TOOL_NAME } from '../../tools/ArtifactCheckTool/constants.js'
import { ARTIFACT_COPY_TOOL_NAME } from '../../tools/ArtifactCopyTool/constants.js'
import { browserToolName } from '../../utils/browserControl/common.js'
import { CANVAS_ENTRY_HTML, CANVAS_SCRIPT_PATH } from '../../utils/canvas.js'
import { registerBundledSkill } from '../bundledSkills.js'

const navigate = browserToolName('navigate')
const closeTab = browserToolName('close_tab')
const snapshot = browserToolName('snapshot')
const click = browserToolName('click')
const typeText = browserToolName('type')

export const ARTIFACTS_SKILL_PROMPT = `# Artifacts

An artifact is something the user keeps: a page, a prototype or a document that stays after the conversation. It is a folder in the \`dc_artifacts/\` directory of your current working directory. The user finds it in the Artifacts list, opens it in the side browser and can hand it to another session.

## When to create one

- Create one directly only when the user says so: they ask for an artifact, say to save or keep the result, or the work comes from Design mode.
- Asking for a page, a small page, a mockup or a display ("make a page of this", "show me this as a page") is not asking for an artifact. Ask first with AskUserQuestion ("Save this as an artifact?") and write only after the user agrees. If the user declines, show it with ShowUI.
- You think something should be kept: ask the same way.
- A chart, table or explanation that is only for this conversation is not an artifact: use ShowUI. A page that serves a dev server for the side panel is not an artifact either.

## Layout

\`\`\`
dc_artifacts/<name>/
  artifact.json
  index.html
\`\`\`

- Write only inside \`dc_artifacts/\` of your current working directory (for a sub-agent in a worktree, that worktree). Artifacts anywhere else, including other worktrees, other projects and the global store, are read-only: reading them needs no permission, writing them is refused. To change one, copy it into your working directory with ${ARTIFACT_COPY_TOOL_NAME} (the user confirms) and edit the copy. A background agent cannot copy; if its write is refused it reports that to the parent agent.
- \`<name>\` is a short lowercase slug. It cannot be \`systems\`.
- Use Write or Edit to create and change files, so the change is tracked and the user's views refresh.
- \`artifact.json\` is the manifest:

\`\`\`json
{ "version": 1, "id": "3f1c9a52-8d4e-4b7a-9c61-0e2f5a7b8d13", "kind": "page", "title": "Quarterly report", "entry": "index.html" }
\`\`\`

\`id\` identifies the artifact for good, also after it moves: generate a new random UUID v4 for each new artifact and never change it afterwards. \`kind\` is \`page\` for pages and prototypes and \`canvas\` for a canvas (see Canvas below). \`entry\` is the HTML file relative to the artifact folder, and every kind needs one.

## How to build it

- Keep the page content in the HTML file itself; do not generate the whole page from a script at load time.
- Use plain CSS and plain JavaScript. Do not use a framework that needs a build step.
- The page can only read files inside \`dc_artifacts/\`. Copy any image, font or script into the artifact folder and reference it with a relative path. A reference such as \`../../logo.png\` will not load.
- Do not put secrets in an artifact.

## Canvas

A canvas puts several boards, each a separate HTML page of the same artifact, on one surface that the user can pan and zoom, and whose boards the user can drag and resize. Use it when the user wants to see screens or variants side by side, such as a flow, a set of options or a design review.

\`\`\`
dc_artifacts/<name>/
  artifact.json
  index.html
  home.html
  detail.html
\`\`\`

The manifest has \`"kind": "canvas"\`, \`"entry": "index.html"\` and a \`boards\` list. \`x\`, \`y\`, \`width\` and \`height\` are in canvas pixels (the page size of the board; the board's title bar sits above it); leave space between boards so none overlap. The canvas does not grow a board to fit its page: write the board file first, measure its content height by running \`document.documentElement.scrollHeight\` on it with the browser tools, then set \`height\` to that number.

\`\`\`json
{
  "version": 1, "id": "<new UUID v4>", "kind": "canvas", "title": "Checkout flow", "entry": "index.html",
  "boards": [
    { "id": "home", "title": "Home", "file": "home.html", "x": 0, "y": 0, "width": 390, "height": 844 },
    { "id": "detail", "title": "Detail", "file": "detail.html", "x": 470, "y": 0, "width": 390, "height": 844 }
  ]
}
\`\`\`

- \`index.html\` is always exactly this text; do not change it, the app supplies the canvas script it loads (${CANVAS_SCRIPT_PATH}):

\`\`\`html
${CANVAS_ENTRY_HTML}\`\`\`

- Each board is an ordinary page of the artifact: write it like any page above. \`file\` is a relative path inside the artifact folder. It cannot be an absolute path, a web address or contain \`..\`. A board cannot be an outside website; to refer to one, save a screenshot as an image and show it on a board.
- \`id\` is unique in the canvas. \`title\` is optional and names the board for the user and in snapshots.
- The user moves and resizes boards by dragging; the app then rewrites only x, y, width and height in artifact.json. Read the manifest again before you edit it, and change those four numbers only for the board you mean to move.
- To read the canvas, take a \`${snapshot}\`. A snapshot lists at most 150 interactive elements and splits them between the boards, so a board that is far outside the view may get none. Its section header names the board and gives an iframe id: pass it as \`region\` to read just that board. Or open that board's file on its own with \`${navigate}\`.
- A board's page gets no mouse or keyboard input on the canvas until it is in interaction mode: a \`${click}\`, \`${typeText}\` or hover aimed at an element inside a board lands on the canvas and does nothing. To act inside a board, first click the Interact button in that board's title bar (a snapshot lists it as a button named \`Interact: <board title>\`, or \`交互: <board title>\` when the app is in Chinese; the board id stands in for the title when the board has none); after that, clicks and typing reach its page. Click the same button again (\`Stop interacting: <board title>\`) or press Escape to leave; only one board is in interaction mode at a time. Reading the canvas (snapshot, screenshot, evaluate) needs no interaction mode. Or open that board's file on its own tab and work there.
- A board cannot be exported on the canvas page. The user opens one board in its own tab and exports it there.

## Show it and check it

1. Run ${ARTIFACT_CHECK_TOOL_NAME} on the artifact folder and fix every problem it lists.
2. Open it with \`${navigate}\` using the artifact folder as the url and \`newTab: true\`, so the tab the user is looking at is not replaced. The result gives the tab id; reuse that tab for later checks with \`tabId\`, and close it with \`${closeTab}\` when you no longer need it.
3. Take a snapshot or screenshot and fix what looks wrong.

## Git

The first time you create an artifact in a git project, tell the user once: dc_artifacts/ is excluded from git through .git/info/exclude; deleting that line tracks it.
`

export function registerArtifactsSkill(): void {
  registerBundledSkill({
    name: 'artifacts',
    description:
      'Create and maintain artifacts: pages and documents kept in dc_artifacts/ that the user can open, revisit and hand to another session.',
    whenToUse:
      'Use when the user asks for an artifact, or when something should be kept as a page instead of shown inline. Not for charts and tables that only serve this conversation (use ShowUI).',
    userInvocable: true,
    async getPromptForCommand(args) {
      const parts = [ARTIFACTS_SKILL_PROMPT]
      if (args) {
        parts.push(`## User Request\n\n${args}`)
      }
      return [{ type: 'text', text: parts.join('\n') }]
    },
  })
}
