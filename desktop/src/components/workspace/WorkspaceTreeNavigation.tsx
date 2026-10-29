import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react'

export function WorkspaceTreeNavigation({ label, children }: { label: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const activePath = useRef<string | null>(null)
  const pendingChild = useRef<string | null>(null)
  const items = () => Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])
  const focus = (item: HTMLButtonElement | undefined) => {
    if (!item) return
    activePath.current = item.dataset.treePath ?? null
    for (const row of items()) row.tabIndex = row === item ? 0 : -1
    item.focus()
  }

  useEffect(() => {
    const rows = items()
    const active = rows.find((row) => row.dataset.treePath === activePath.current) ?? rows[0]
    for (const row of rows) row.tabIndex = row === active ? 0 : -1
    if (pendingChild.current !== null) {
      const parent = rows.find((row) => row.dataset.treePath === pendingChild.current)
      const child = rows.find((row) => row.dataset.parentPath === pendingChild.current)
      if (!parent || parent.getAttribute('aria-expanded') !== 'true') pendingChild.current = null
      else if (child && document.activeElement === parent) {
        pendingChild.current = null
        focus(child)
      }
    }
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = event.target
    if (!(row instanceof HTMLButtonElement) || row.getAttribute('role') !== 'treeitem') return
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    pendingChild.current = null
    const rows = items()
    const index = rows.indexOf(row)
    if (event.key === 'Home') focus(rows[0])
    else if (event.key === 'End') focus(rows.at(-1))
    else if (event.key === 'ArrowDown') focus(rows[Math.min(rows.length - 1, index + 1)])
    else if (event.key === 'ArrowUp') focus(rows[Math.max(0, index - 1)])
    else if (event.key === 'ArrowLeft') {
      if (row.getAttribute('aria-expanded') === 'true') row.click()
      else focus(rows.find((item) => item.dataset.treePath === row.dataset.parentPath))
    } else if (row.getAttribute('aria-expanded') !== 'true') row.click()
    else if (row.dataset.directory === 'true') {
      const child = rows.find((item) => item.dataset.parentPath === row.dataset.treePath)
      if (child) focus(child)
      else pendingChild.current = row.dataset.treePath ?? null
    }
  }

  return (
    <div ref={rootRef} role="tree" aria-label={label} onKeyDown={onKeyDown} onFocusCapture={(event) => {
      const row = event.target
      if (row instanceof HTMLButtonElement && row.getAttribute('role') === 'treeitem') {
        pendingChild.current = null
        activePath.current = row.dataset.treePath ?? null
        for (const item of items()) item.tabIndex = item === row ? 0 : -1
      }
    }} onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) pendingChild.current = null
    }}>{children}</div>
  )
}
