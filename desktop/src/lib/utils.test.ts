import { expect, it } from 'vitest'
import { cn } from './utils'

it('merges conditional styles without dropping independent theme colors', () => {
  expect(cn('px-2 text-ui-foreground', false && 'hidden', { 'px-4': true }, ['bg-ui-muted'])).toBe('text-ui-foreground px-4 bg-ui-muted')
})

it('keeps theme font sizes next to text colors', () => {
  expect(cn('text-ui-aux text-[var(--color-text-secondary)]')).toBe('text-ui-aux text-[var(--color-text-secondary)]')
})

it('lets a theme font size replace a default font size', () => {
  expect(cn('text-sm', 'text-ui-message')).toBe('text-ui-message')
})
