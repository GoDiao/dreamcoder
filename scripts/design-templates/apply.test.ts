import { describe, expect, it } from 'bun:test'
import { applyDrafts } from './apply'
import type { Curation, TemplateCuration } from './convert'
import type { Draft } from './describe'

const entry = (overrides: Partial<TemplateCuration> = {}): TemplateCuration => ({
  category: 'web',
  acceptsDesignSystem: true,
  title: { en: 'Hand', zh: '手写' },
  descriptionZh: '手写简介',
  tags: ['hand'],
  prompt: { en: 'keep', zh: '保留' },
  style: { en: 'Hand style.', zh: '手写风格。' },
  ...overrides,
})

const draft = (id: string, overrides: Partial<Draft> = {}): Draft => ({
  id,
  sourceDir: 'design-templates',
  model: 'm',
  fit: 'page',
  fitReason: 'r',
  category: 'prototype',
  acceptsDesignSystem: false,
  acceptsReason: 'r',
  title: { en: `Draft ${id}`, zh: `草稿 ${id}` },
  descriptionZh: '草稿简介',
  tags: ['a', 'b', 'c'],
  prompt: { en: 'p', zh: '提' },
  style: { en: 'Draft style.', zh: '草稿风格。' },
  relativeReferences: [],
  indexChars: 100,
  usage: { promptTokens: 1, completionTokens: 1 },
  ...overrides,
})

const curation = (templates: Record<string, TemplateCuration>): Curation => ({ sourceRepo: 'https://example.com/r', templates })

describe('applyDrafts', () => {
  it('adds approved page drafts in the approved order and keeps existing entries untouched', () => {
    const existing = entry()
    const { curation: next, report } = applyDrafts(curation({ own: existing }), [draft('b'), draft('a')], { ids: ['a', 'b'] })
    expect(Object.keys(next.templates)).toEqual(['own', 'a', 'b'])
    expect(next.templates.own).toBe(existing)
    expect(next.templates.a).toEqual({
      category: 'prototype',
      acceptsDesignSystem: false,
      title: { en: 'Draft a', zh: '草稿 a' },
      descriptionZh: '草稿简介',
      tags: ['a', 'b', 'c'],
      prompt: { en: 'p', zh: '提' },
      style: { en: 'Draft style.', zh: '草稿风格。' },
    })
    expect(report.added).toEqual(['a', 'b'])
  })

  it('records the source folder only when it is not the default', () => {
    const { curation: next } = applyDrafts(curation({}), [draft('s', { sourceDir: 'skills' }), draft('d')], { ids: ['s', 'd'] })
    expect(next.templates.s!.sourceDir).toBe('skills')
    expect('sourceDir' in next.templates.d!).toBe(false)
  })

  it('applies overrides on top of the draft', () => {
    const { curation: next } = applyDrafts(curation({}), [draft('a')], {
      ids: ['a'],
      overrides: { a: { title: { en: 'Better', zh: '更好' }, category: 'web', style: { en: 'Edited.', zh: '改过。' } } },
    })
    expect(next.templates.a).toMatchObject({ title: { en: 'Better', zh: '更好' }, category: 'web', style: { en: 'Edited.', zh: '改过。' }, tags: ['a', 'b', 'c'] })
  })

  it('skips ids whose fit is not page, that have no draft, or whose id exists in both folders', () => {
    const drafts = [draft('deck', { fit: 'slides' }), draft('twin'), draft('twin', { sourceDir: 'skills' })]
    const { curation: next, report } = applyDrafts(curation({}), drafts, { ids: ['deck', 'ghost', 'twin'] })
    expect(Object.keys(next.templates)).toEqual([])
    expect(report.skipped).toEqual([
      { id: 'deck', reason: 'fit is slides' },
      { id: 'ghost', reason: 'no draft' },
      { id: 'twin', reason: 'the id has drafts in more than one source folder' },
    ])
  })

  it('fills in only the style of an existing entry that has none, and never overwrites a style', () => {
    const missing = { ...entry(), style: undefined } as unknown as TemplateCuration
    const { curation: next, report } = applyDrafts(curation({ old: missing, kept: entry() }), [draft('old'), draft('kept')], { ids: ['old', 'kept'] })
    expect(next.templates.old).toEqual({ ...missing, style: { en: 'Draft style.', zh: '草稿风格。' } })
    expect(next.templates.kept!.style).toEqual({ en: 'Hand style.', zh: '手写风格。' })
    expect(report.styled).toEqual(['old'])
    expect(report.added).toEqual([])
  })

  it('reports an existing entry without style when no draft exists for it', () => {
    const missing = { ...entry(), style: undefined } as unknown as TemplateCuration
    const { report } = applyDrafts(curation({ old: missing }), [], { ids: [] })
    expect(report.skipped).toEqual([{ id: 'old', reason: 'existing entry has no style and there is no draft for it' }])
  })

  it('does not change the curation it was given', () => {
    const base = curation({ own: entry() })
    applyDrafts(base, [draft('a')], { ids: ['a'] })
    expect(Object.keys(base.templates)).toEqual(['own'])
  })
})
