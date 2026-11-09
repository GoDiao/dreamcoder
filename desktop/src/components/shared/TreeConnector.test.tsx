import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TreeConnector, treeGuides } from './TreeConnector'

describe('treeGuides', () => {
  it('marks the last child of each parent and keeps an ancestor rail while its siblings follow', () => {
    expect(treeGuides([0, 1, 2, 2, 1, 0])).toEqual([
      { depth: 0, last: false, rails: [] },
      { depth: 1, last: false, rails: [] },
      { depth: 2, last: false, rails: [1] },
      { depth: 2, last: true, rails: [1] },
      { depth: 1, last: true, rails: [] },
      { depth: 0, last: true, rails: [] },
    ])
  })

  it('drops the rail once the ancestor has no later sibling', () => {
    expect(treeGuides([0, 1, 1, 2]).map((guide) => guide.rails)).toEqual([[], [], [], []])
  })
})

describe('TreeConnector', () => {
  it('draws nothing for a top-level row and an elbow for a child', () => {
    const { container, rerender } = render(<TreeConnector guide={{ depth: 0, last: true, rails: [] }} indent={14} />)
    expect(container.childElementCount).toBe(0)

    rerender(<TreeConnector guide={{ depth: 2, last: true, rails: [1] }} indent={14} />)
    expect(screen.getAllByTestId('tree-connector-elbow')).toHaveLength(1)
    expect(screen.getByTestId('tree-connector-elbow').style.left).toBe('21px')
    expect(screen.getAllByTestId('tree-connector-rail')).toHaveLength(1)
  })
})
