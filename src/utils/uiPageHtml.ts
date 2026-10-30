import { createHash } from 'node:crypto'
import { COMPONENT_DATA_MARKER } from '../../vendor/showai/src/components/custom/contract.js'

export const HTML_BLOCK_KIND = 'html'
export const CUSTOM_BLOCK_KIND = 'custom'
const HTML_BLOCK_MAX_BYTES = 256 * 1024
const HTML_COMPONENT_PREFIX = 'dc-html-'
const HTML_COMPONENT_VERSION = '1.0.0'
const MIN_HEIGHT = 80
const MAX_HEIGHT = 2000

export type HtmlComponent = {
  id: string
  name: string
  version: string
  integrity: string
  html: string
  schema: true
  inline: { script: string; styles: string }
}

type CustomBlockData = { componentId: string; version: string; integrity: string; props: Record<string, never> }

export const HTML_BLOCK_GUIDE = {
  kind: HTML_BLOCK_KIND,
  name: 'HTML',
  description:
    'A self-contained HTML document you write, for what no component can show: concept illustrations, custom diagrams, animations and interactive demos drawn with inline SVG, canvas and script.',
  propsSchema: {
    type: 'object',
    required: ['html', 'reason'],
    properties: {
      html: { type: 'string', description: `A complete HTML document, at most ${HTML_BLOCK_MAX_BYTES} bytes.` },
      title: { type: 'string', description: 'A short name for the block.' },
      reason: { type: 'string', description: 'Which components you considered for this part and why none of them can draw it. Not shown to the user.' },
    },
    additionalProperties: false,
  },
  guide: {
    usage: {
      purpose: 'The last resort. Choose in this order: adjust an existing component\'s data and layout, combine several components, and only then write html for a part none of them can draw. Prefer step-walkthrough or stepper for mechanisms and steps, and chart, g2-*, table, flowchart and the other components for data and standard diagrams.',
      structure: [
        'The document runs in its own sandboxed frame inside the page. document, getElementById and querySelector work as in a normal page.',
        'It is fully offline: inline all CSS and JavaScript, draw with SVG or canvas, use data: URIs for images. No CDN, fetch, XMLHttpRequest, WebSocket, forms or popups.',
        'localStorage, cookies and window.parent are not available.',
        'The frame is as wide as the page (about 650px in the conversation) and grows with the content; design for that width and keep it usable down to 320px.',
        'Set html and body to a transparent background and use a color-scheme of light dark, so the block reads well in both themes.',
      ],
      constraints: [
        'reason is required: name the components you considered and why none of them can draw this part.',
        'To change the block, remove it with block.remove and insert a new html block in its place; component.props.set does not apply.',
      ],
    },
  },
  examples: [
    {
      name: 'Swinging pendulum',
      data: {
        title: 'Pendulum',
        reason: 'An animated swing over time: flowchart, chart and scene-3d have no motion along an arc driven by time.',
        html: '<!doctype html><html><head><style>html,body{margin:0;background:transparent;color-scheme:light dark;font:14px system-ui}</style></head><body><svg viewBox="0 0 600 220" width="100%"><line id="rod" x1="300" y1="20" x2="300" y2="180" stroke="currentColor" stroke-width="2"/><circle id="bob" cx="300" cy="180" r="14" fill="currentColor"/></svg><script>const rod=document.getElementById("rod"),bob=document.getElementById("bob");function frame(t){const a=0.6*Math.cos(t/500),x=300+160*Math.sin(a),y=20+160*Math.cos(a);rod.setAttribute("x2",x);rod.setAttribute("y2",y);bob.setAttribute("cx",x);bob.setAttribute("cy",y);requestAnimationFrame(frame)}requestAnimationFrame(frame);</script></body></html>',
      },
    },
  ],
}

function frameScript(html: string): string {
  const reporter = `<script>(function(){var last=-1;function report(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h!==last){last=h;parent.postMessage({dreamcoderHtmlHeight:h},'*');}}new ResizeObserver(report).observe(document.documentElement);addEventListener('load',report);report();})();</script>`
  return `var ShowAIInlineComponent={mount:function(root){var frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');frame.style.cssText='display:block;width:100%;border:0;background:transparent;height:160px';function onMessage(event){if(event.source!==frame.contentWindow||!event.data||typeof event.data.dreamcoderHtmlHeight!=='number')return;frame.style.height=Math.min(${MAX_HEIGHT},Math.max(${MIN_HEIGHT},event.data.dreamcoderHtmlHeight))+'px';}window.addEventListener('message',onMessage);frame.srcdoc=${JSON.stringify(`${html}${reporter}`)};root.appendChild(frame);return{update:function(){},destroy:function(){window.removeEventListener('message',onMessage);root.replaceChildren();}};}};`
}

export function htmlBlockProblem(data: Record<string, unknown>): string | null {
  if (typeof data.html !== 'string' || !data.html.trim()) return 'An html block needs data.html, a complete HTML document.'
  if (Buffer.byteLength(data.html, 'utf8') > HTML_BLOCK_MAX_BYTES) return `An html block is at most ${HTML_BLOCK_MAX_BYTES} bytes.`
  if (data.title !== undefined && typeof data.title !== 'string') return 'data.title of an html block must be text.'
  if (typeof data.reason !== 'string' || !data.reason.trim()) {
    return 'An html block needs data.reason: name the components you considered for this part and why none of them can draw it. If one can, use it instead.'
  }
  const extra = Object.keys(data).filter((key) => !['html', 'title', 'reason'].includes(key))
  return extra.length > 0 ? `An html block takes only html, title and reason, not ${extra.join(', ')}; its height follows the content.` : null
}

export function compileHtmlBlock(data: { html: string; title?: string }): { component: HtmlComponent; data: CustomBlockData } {
  const script = frameScript(data.html)
  const digest = createHash('sha256').update(script).digest('hex')
  const component: HtmlComponent = {
    id: `${HTML_COMPONENT_PREFIX}${digest.slice(0, 16)}`,
    name: data.title?.trim() || 'HTML',
    version: HTML_COMPONENT_VERSION,
    integrity: `sha256-${digest}`,
    html: COMPONENT_DATA_MARKER,
    schema: true,
    inline: { script, styles: '' },
  }
  return { component, data: { componentId: component.id, version: component.version, integrity: component.integrity, props: {} } }
}

export function isHtmlComponentId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(HTML_COMPONENT_PREFIX)
}
