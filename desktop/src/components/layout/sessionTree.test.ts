import { describe, expect, it } from 'vitest'
import { buildSessionTreeRows, unfoldSessionTreeRows } from './sessionTree'
import type { SessionListItem } from '../../types/session'

function session(id: string, modifiedAt: string, parentId?: string): SessionListItem {
  return {
    id,
    title: id,
    createdAt: modifiedAt,
    modifiedAt,
    messageCount: 1,
    projectPath: '/p',
    workDir: '/p',
    workDirExists: true,
    ...(parentId ? { parent: { sessionId: parentId, kind: 'spawned' as const } } : {}),
  }
}

describe('buildSessionTreeRows', () => {
  it('keeps roots and siblings in the given order, whatever their activity times', () => {
    const rows = buildSessionTreeRows([
      session('a', '2026-11-04T10:00:00Z'),
      session('b', '2026-11-04T09:00:00Z'),
      session('a1', '2026-11-04T01:00:00Z', 'a'),
      session('a2', '2026-11-04T02:00:00Z', 'a'),
    ])
    expect(rows.map((r) => [r.session.id, r.depth, r.childCount])).toEqual([
      ['a', 0, 2],
      ['a1', 1, 0],
      ['a2', 1, 0],
      ['b', 0, 0],
    ])
  })

  it('treats a session whose parent is absent as a root', () => {
    const rows = buildSessionTreeRows([session('x', '2026-11-04T10:00:00Z', 'missing')])
    expect(rows.map((r) => [r.session.id, r.depth])).toEqual([['x', 0]])
  })

  it('still lists every session when parents form a cycle', () => {
    const rows = buildSessionTreeRows([
      session('a', '2026-11-04T10:00:00Z', 'b'),
      session('b', '2026-11-04T09:00:00Z', 'a'),
    ])
    expect(rows.map((r) => r.session.id).sort()).toEqual(['a', 'b'])
  })
})

describe('unfoldSessionTreeRows', () => {
  it('drops every descendant of a collapsed row and nothing else', () => {
    const rows = buildSessionTreeRows([
      session('a', '2026-11-04T10:00:00Z'),
      session('a1', '2026-11-04T09:00:00Z', 'a'),
      session('a1x', '2026-11-04T08:00:00Z', 'a1'),
      session('b', '2026-11-04T07:00:00Z'),
      session('b1', '2026-11-04T06:00:00Z', 'b'),
    ])
    expect(unfoldSessionTreeRows(rows, new Set(['a'])).map((r) => r.session.id)).toEqual(['a', 'b', 'b1'])
    expect(unfoldSessionTreeRows(rows, new Set(['a1'])).map((r) => r.session.id)).toEqual(['a', 'a1', 'b', 'b1'])
    expect(unfoldSessionTreeRows(rows, new Set())).toBe(rows)
  })
})
