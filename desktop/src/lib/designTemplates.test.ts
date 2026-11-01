import { describe, expect, it } from 'vitest'
import type { DesignTemplate } from '../types/design'
import { filterDesignTemplates } from './designTemplates'

const template = (id: string, category: DesignTemplate['category'], overrides: Partial<DesignTemplate> = {}): DesignTemplate => ({
  id,
  category,
  platform: 'desktop',
  scenario: null,
  entry: 'index.html',
  acceptsDesignSystem: true,
  title: { en: `Title ${id}`, zh: `标题 ${id}` },
  description: { en: `About ${id}`, zh: `关于 ${id}` },
  tags: [],
  ...overrides,
})

const templates = [
  template('saas-landing', 'web', { title: { en: 'Launch page', zh: '发布页' }, description: { en: 'Hero and pricing', zh: '首屏与定价' }, tags: ['marketing'] }),
  template('kanban', 'prototype', { title: { en: 'Task board', zh: '任务看板' }, description: { en: 'Columns of cards', zh: '分栏卡片' }, tags: ['productivity', 'drag'] }),
  template('blog', 'web', { title: { en: 'Journal', zh: '日志' }, description: { en: 'Long reads', zh: '长文' }, tags: ['editorial'] }),
]

const ids = (found: DesignTemplate[]) => found.map((item) => item.id)

describe('filterDesignTemplates', () => {
  it('keeps everything without a category and a query', () => {
    expect(filterDesignTemplates(templates, null, '  ')).toHaveLength(3)
  })

  it('matches the id', () => {
    expect(ids(filterDesignTemplates(templates, null, 'saas-land'))).toEqual(['saas-landing'])
  })

  it('matches the English title', () => {
    expect(ids(filterDesignTemplates(templates, null, 'task board'))).toEqual(['kanban'])
  })

  it('matches the Chinese title', () => {
    expect(ids(filterDesignTemplates(templates, null, '日志'))).toEqual(['blog'])
  })

  it('matches the English description', () => {
    expect(ids(filterDesignTemplates(templates, null, 'pricing'))).toEqual(['saas-landing'])
  })

  it('matches the Chinese description', () => {
    expect(ids(filterDesignTemplates(templates, null, '分栏'))).toEqual(['kanban'])
  })

  it('matches any one of the tags', () => {
    expect(ids(filterDesignTemplates(templates, null, 'drag'))).toEqual(['kanban'])
    expect(ids(filterDesignTemplates(templates, null, 'editorial'))).toEqual(['blog'])
  })

  it('ignores case and surrounding spaces', () => {
    expect(ids(filterDesignTemplates(templates, null, '  JOURNAL '))).toEqual(['blog'])
  })

  it('combines category and query', () => {
    expect(ids(filterDesignTemplates(templates, 'web', 'a'))).toEqual(['saas-landing', 'blog'])
    expect(filterDesignTemplates(templates, 'prototype', 'journal')).toEqual([])
  })

  it('returns nothing when no field matches', () => {
    expect(filterDesignTemplates(templates, null, 'zzz')).toEqual([])
  })
})
