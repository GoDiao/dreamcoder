import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from '../stores/settingsStore'
import { translate, useTranslation } from '.'

describe('translate', () => {
  it('interpolates dollar sequences literally', () => {
    expect(
      translate('en', 'sidebar.projectActions', { project: 'cost: $$5 and $&' }),
    ).toBe('Project actions for cost: $$5 and $&')
  })
})

describe('useTranslation', () => {
  afterEach(() => {
    act(() => {
      useSettingsStore.getState().setLocale('zh')
    })
  })

  it('keeps the translation function stable until the locale changes', () => {
    act(() => {
      useSettingsStore.getState().setLocale('zh')
    })

    const { result, rerender } = renderHook(() => useTranslation())
    const initial = result.current

    rerender()
    expect(result.current).toBe(initial)

    act(() => {
      useSettingsStore.getState().setLocale('en')
    })
    expect(result.current).not.toBe(initial)
  })
})
