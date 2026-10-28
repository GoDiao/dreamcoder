import { getSelectionAnchor, readComposedSelection } from '../../lib/selectionPopover'

export type WorkspaceTextSelection = { text: string; startLine?: number; endLine?: number }
export type WorkspaceQuoteSelection = WorkspaceTextSelection & ReturnType<typeof getSelectionAnchor>

function composedContains(root: Node, node: Node | null): boolean {
  let current = node
  while (current) {
    if (current === root || root.contains(current)) return true
    const tree = current.getRootNode()
    current = tree instanceof ShadowRoot ? tree.host : null
  }
  return false
}

function readWorkspaceRange(root: HTMLElement): Range | null {
  const { shadows, selection } = readComposedSelection(root)
  if (!selection || selection.isCollapsed) return null
  const composed = selection as Selection & { getComposedRanges?: (...roots: Array<ShadowRoot | { shadowRoots: ShadowRoot[] }>) => StaticRange[] }
  let staticRange: StaticRange | undefined
  if (composed.getComposedRanges) {
    try {
      staticRange = composed.getComposedRanges({ shadowRoots: shadows })[0]
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      staticRange = composed.getComposedRanges(...shadows)[0]
    }
  }
  let range: Range
  if (staticRange) {
    range = document.createRange()
    range.setStart(staticRange.startContainer, staticRange.startOffset)
    range.setEnd(staticRange.endContainer, staticRange.endOffset)
  } else if (selection.rangeCount && composedContains(root, selection.getRangeAt(0).startContainer) && composedContains(root, selection.getRangeAt(0).endContainer)) {
    range = selection.getRangeAt(0)
  } else if (selection.anchorNode && selection.focusNode && composedContains(root, selection.anchorNode) && composedContains(root, selection.focusNode)) {
    range = document.createRange()
    range.setStart(selection.anchorNode, selection.anchorOffset)
    range.setEnd(selection.focusNode, selection.focusOffset)
    if (range.collapsed) {
      range.setStart(selection.focusNode, selection.focusOffset)
      range.setEnd(selection.anchorNode, selection.anchorOffset)
    }
  } else if (selection.rangeCount) range = selection.getRangeAt(0)
  else return null
  return !range.collapsed && composedContains(root, range.startContainer) && composedContains(root, range.endContainer) ? range : null
}

function readWorkspaceText(range: Range): WorkspaceTextSelection | null {
  const element = (node: Node) => node instanceof Element ? node : node.parentElement
  const rowSelector = '[data-workspace-line-number], [data-line]'
  const row = (node: Node) => element(node)?.closest(rowSelector)
  const startRow = row(range.startContainer)
  const rows = startRow ? Array.from((startRow.getRootNode() as Document | ShadowRoot).querySelectorAll(rowSelector)).filter((node) => range.intersectsNode(node)) : []
  const lastRow = rows.at(-1)
  if (rows.length > 1 && lastRow) {
    const lead = document.createRange()
    lead.selectNodeContents(lastRow)
    lead.setEnd(range.endContainer, range.endOffset)
    if (!lead.toString()) rows.pop()
  }
  const endRow = rows.at(-1) ?? row(range.endContainer)
  const line = (node: Element | null | undefined) => {
    if (!node || node.getAttribute('data-line-type') === 'change-deletion') return undefined
    const value = Number(node.getAttribute('data-workspace-line-number') ?? node.getAttribute('data-line'))
    return value > 0 ? value : undefined
  }
  const inShadow = range.startContainer.getRootNode() instanceof ShadowRoot
  let text = ((inShadow ? undefined : window.getSelection()?.toString()) ?? range.toString()).trim()
  let includesDeletedLine = false
  if (inShadow && rows.length > 1) {
    includesDeletedLine = rows.some((node) => node.getAttribute('data-line-type') === 'change-deletion')
    text = rows.map((node) => node.textContent ?? '').join('\n').trim()
  }
  if (!text) return null
  const startLine = line(startRow)
  const endLine = line(endRow)
  return { text, ...(!includesDeletedLine && startLine && endLine ? { startLine: Math.min(startLine, endLine), endLine: Math.max(startLine, endLine) } : {}) }
}

export function getTextSelectionFromContainer(
  root: HTMLElement | null,
  pointer: { clientX: number; clientY: number },
  resolveLines?: (text: string, range: Range) => { startLine?: number; endLine?: number },
): WorkspaceQuoteSelection | null {
  if (!root) return null

  const range = readWorkspaceRange(root)
  if (!range) return null
  const selected = readWorkspaceText(range)
  if (!selected) return null
  const resolvedLines = resolveLines?.(selected.text, range) ?? selected
  const startLine = resolvedLines.startLine
  const endLine = resolvedLines.endLine ?? startLine

  return {
    ...getSelectionAnchor(range, pointer),
    text: selected.text,
    ...(startLine ? { startLine } : {}),
    ...(endLine ? { endLine } : {}),
  }
}
