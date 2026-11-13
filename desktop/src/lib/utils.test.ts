import { expect, it } from 'vitest'
import { cn } from './utils'

it('merges conditional styles without dropping independent theme colors', () => {
  expect(cn('px-2 text-foreground', false && 'hidden', { 'px-4': true }, ['bg-muted'])).toBe('text-foreground px-4 bg-muted')
})

it('keeps theme font sizes next to text colors', () => {
  expect(cn('text-xs text-muted-foreground')).toBe('text-xs text-muted-foreground')
})

it('lets a theme font size replace a default font size', () => {
  expect(cn('text-sm', 'text-sm')).toBe('text-sm')
})
