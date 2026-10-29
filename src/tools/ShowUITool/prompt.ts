import { UI_PAGE_KINDS, UI_PAGE_MAX_BYTES } from '../../utils/uiPages.js'

export const DESCRIPTION =
  'Show the user charts, tables, diagrams and interactive pages right in the conversation, or change one you showed earlier. Use it whenever the user asks to chart, plot, graph, draw or visualize data or a table, or to show something on a page.'

export const PROMPT = `Shows the user a page rendered inline in the conversation, built from components: formatted text, charts, tables, diagrams and interactive playgrounds.

When to use it:
- The user asks to chart, plot, graph, draw or visualize data, or to turn a table into a chart: use this tool. "Show it on the page" or "draw it in the page" also means this tool.
- A chart, a table or something the user can adjust answers better than plain text.
- Pick a fitting chart and show it; do not first ask which tool or output format to use. The user can ask for changes afterwards.
- Do not write plotting scripts (matplotlib and the like), generate image or HTML files, or change the project's code to show a chart, unless the user explicitly asks for a file or a code change.

A page is a list of blocks. Each block is { kind, data }: you supply data in the component's format and the app renders it. When no component can show what you need, an html block holds a self-contained HTML document you write.

Every call below is this one ShowUI tool with different input. There are no separate Catalog, Describe or Read tools for pages, and the Read tool cannot open pages.
- ShowUI({ catalog: true }) lists every component with a short description and a one-line data signature.
- ShowUI({ describe: ["chart", "mindmap"] }) returns each component's guide (field meanings, recipes and constraints), data format and examples. Follow the guide: for example, g2-* charts keep the example's dataset keys and map the example's field names to yours through fields.
- ShowUI({ title, blocks: [{ kind, data }] }) creates a page and returns { pageId, revision, blocks: [{ id, kind, component }] }.
- ShowUI({ pageId, baseRevision, operations }) applies the operations together as the next revision and returns the same fields.
- ShowUI({ pageId }) returns the latest revision with every block and its id.

The component catalog and guides are written in Chinese, and their examples hold Chinese sample data. Write page titles, text, labels and data, and your reply, in the language of the user's messages, not in the language of the documentation.

Steps, enforced by the tool:
1. Before your first page in a conversation, call ShowUI({ catalog: true }) and choose the components that show the content best: charts for numbers over time or across items, diagrams for flows and structures, playgrounds for what-if inputs, tables for exact values.
2. Call ShowUI({ describe: [...] }) for every kind you will use, in one call, before using it. A create or insert with a kind you have not described is rejected and nothing is saved.
3. Create the page. Text needs no describe: { kind: "text", data: { format: "markdown", content } }; markdown may include $math$.

Keep each call small: blocks and operations are JSON arrays, never strings. Create the page with its first few blocks, then add the rest with component.insert in later changes. Very long or deeply nested input is the most common cause of malformed tool calls.

Components: ${UI_PAGE_KINDS.join(', ')}, and G2 charts named g2-*. To explain how something works, walk through it with step-walkthrough or stepper; show architecture with layer-diagram, archify, diagram-design or fireworks-tech-graph; compare options with comparison-matrix. Choose in this order: adjust an existing component's data and layout, combine several components, and only then write html for a part none of them can draw, such as an animation of a physical process or a custom geometric figure drawn with inline SVG, canvas and script. An html block must say in its reason which components you considered and why they cannot draw that part. The explanation, steps, data charts, tables and standard flows still belong in the components. For a plain bar or line chart use chart: its data is just labels and series. Use a g2-* chart for what chart cannot draw (stacked or grouped bars, pies, scatter, heatmaps, flows and the like); its records must use the field names of the example, or map them with fields, and a chart whose fields do not match is rejected.

Operations change blocks by id:
- { type: "component.insert", kind, data, afterId? } adds a block, at the end when afterId is omitted.
- { type: "component.props.set", blockId, props } replaces the given top-level fields of a component's data. It works only on blocks returned with component: true (charts, g2-*, playground, diagrams, mindmap, timeline). text, table, callout, toggle, divider and code are plain blocks: to change one, block.remove it and component.insert the new version with afterId set to the block before it.
- { type: "block.text.set", blockId, text } replaces the text of a text block.
- { type: "block.remove", blockId } and { type: "block.move", blockId, afterId } remove or reorder a block.
- { type: "page.set", fields: { title } } renames the page.

\`baseRevision\` must be the latest revision. If it is not, the call fails; read the page with ShowUI({ pageId }) and retry. Use the block ids from the latest result; read the page when you need a block's current data. Change a page only through this tool: each change becomes a new revision the user sees. Never read or edit page files with other tools. You cannot see the rendered page: to check what a page holds, read it with ShowUI({ pageId }).

A page is at most ${UI_PAGE_MAX_BYTES} bytes and fully offline: images must be data: URIs. If a call is rejected, the error names the field to fix; nothing is saved.

Pages appear in a chat column about 700px wide and up to 640px tall, and the user can enlarge them. Lay out for that width: give flowcharts with more than four steps direction "TB" so they run top to bottom instead of shrinking to fit a long row, split long flows, and set component heights to what the content needs instead of leaving empty space.

The page is shown after this tool call completes, right where you called the tool, and follows the app's light or dark theme. The user already sees it: do not repeat its data, tables or text in your reply. At most add one sentence on what it shows.`
