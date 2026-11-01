import { describe, expect, it } from 'vitest'
import type { DesignSystem } from '../types/design'
import { designSystemCategories, filterDesignSystems } from './designSystems'

const system = (id: string, category: string, name = id, zh = ''): DesignSystem => ({
  id,
  name: { en: name, zh },
  category,
  description: { en: `Look of ${name}`, zh: '' },
  origin: 'converted',
  swatches: [],
  license: { id: 'x', file: null, copyright: '' },
  author: '',
})

const systems = [system('b', 'Fintech', 'Bank'), system('a', 'Editorial', 'Paper', '纸感'), system('c', 'Fintech', 'Coin')]

describe('designSystemCategories', () => {
  it('lists each category once, sorted', () => {
    expect(designSystemCategories(systems)).toEqual(['Editorial', 'Fintech'])
  })
})

describe('filterDesignSystems', () => {
  it('keeps everything without a category and a query', () => {
    expect(filterDesignSystems(systems, null, '  ')).toHaveLength(3)
  })

  it('filters by category', () => {
    expect(filterDesignSystems(systems, 'Fintech', '').map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('matches the query against id, names, description and category without regard to case', () => {
    expect(filterDesignSystems(systems, null, 'PAP').map((item) => item.id)).toEqual(['a'])
    expect(filterDesignSystems(systems, null, '纸').map((item) => item.id)).toEqual(['a'])
    expect(filterDesignSystems(systems, null, 'look of coin').map((item) => item.id)).toEqual(['c'])
    expect(filterDesignSystems(systems, null, 'fintech')).toHaveLength(2)
  })

  it('combines category and query', () => {
    expect(filterDesignSystems(systems, 'Fintech', 'coin').map((item) => item.id)).toEqual(['c'])
    expect(filterDesignSystems(systems, 'Editorial', 'coin')).toEqual([])
  })
})
