import type { SessionListItem } from '../../types/session'

export type SessionTreeRow = {
  session: SessionListItem
  depth: number
  childCount: number
}

function modifiedAtOf(session: SessionListItem): number {
  const timestamp = new Date(session.modifiedAt).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function buildSessionTreeRows(sessions: SessionListItem[]): SessionTreeRow[] {
  const ids = new Set(sessions.map((session) => session.id))
  const childrenByParent = new Map<string, SessionListItem[]>()
  const roots: SessionListItem[] = []
  for (const session of sessions) {
    const parentId = session.parent?.sessionId
    if (parentId && parentId !== session.id && ids.has(parentId)) {
      const siblings = childrenByParent.get(parentId) ?? []
      siblings.push(session)
      childrenByParent.set(parentId, siblings)
    } else {
      roots.push(session)
    }
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => modifiedAtOf(b) - modifiedAtOf(a))
  }

  const rows: SessionTreeRow[] = []
  const visited = new Set<string>()
  const walk = (session: SessionListItem, depth: number) => {
    if (visited.has(session.id)) return
    visited.add(session.id)
    const children = childrenByParent.get(session.id) ?? []
    rows.push({ session, depth, childCount: children.length })
    for (const child of children) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  for (const session of sessions) walk(session, 0)
  return rows
}

export function unfoldSessionTreeRows(rows: SessionTreeRow[], collapsedIds: ReadonlySet<string>): SessionTreeRow[] {
  if (collapsedIds.size === 0) return rows
  const result: SessionTreeRow[] = []
  let hiddenBelowDepth: number | null = null
  for (const row of rows) {
    if (hiddenBelowDepth !== null) {
      if (row.depth > hiddenBelowDepth) continue
      hiddenBelowDepth = null
    }
    result.push(row)
    if (row.childCount > 0 && collapsedIds.has(row.session.id)) hiddenBelowDepth = row.depth
  }
  return result
}
