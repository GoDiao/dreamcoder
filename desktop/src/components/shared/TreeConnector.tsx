import type { CSSProperties } from 'react'

export type TreeGuide = { depth: number; last: boolean; rails: number[] }

export function treeGuides(depths: readonly number[]): TreeGuide[] {
  const open: boolean[] = []
  const guides: TreeGuide[] = new Array(depths.length)
  for (let index = depths.length - 1; index >= 0; index -= 1) {
    const depth = depths[index]!
    const rails: number[] = []
    for (let level = 1; level < depth; level += 1) {
      if (open[level]) rails.push(level)
    }
    guides[index] = { depth, last: !open[depth], rails }
    open.length = depth + 1
    open[depth] = true
  }
  return guides
}

const LINE = 'pointer-events-none absolute border-[var(--color-border)]'

export function TreeConnector({ guide, indent, extend = 0 }: { guide: TreeGuide; indent: number; extend?: number }) {
  if (guide.depth === 0) return null
  const x = (level: number) => level * indent - indent / 2
  const rail = (level: number, top: CSSProperties['top']): CSSProperties => ({ left: x(level), top, bottom: -extend })
  return (
    <>
      {guide.rails.map((level) => (
        <span key={level} aria-hidden="true" data-testid="tree-connector-rail" className={`${LINE} border-l`} style={rail(level, 0)} />
      ))}
      <span
        aria-hidden="true"
        data-testid="tree-connector-elbow"
        className={`${LINE} rounded-bl-[5px] border-b border-l`}
        style={{ left: x(guide.depth), top: -extend, height: `calc(50% + ${extend}px)`, width: indent / 2 - 2 }}
      />
      {!guide.last && <span aria-hidden="true" className={`${LINE} border-l`} style={rail(guide.depth, '50%')} />}
    </>
  )
}
