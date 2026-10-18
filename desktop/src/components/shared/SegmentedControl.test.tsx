import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

function Harness() {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('b')
  return (
    <SegmentedControl
      label="Pick"
      value={value}
      onChange={setValue}
      options={[
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ]}
    />
  )
}

describe('SegmentedControl', () => {
  it('keeps only the selected option tabbable and moves the selection with arrow keys', () => {
    render(<Harness />)
    const radio = (name: string) => screen.getByRole('radio', { name })

    expect([radio('A'), radio('B'), radio('C')].map((item) => item.tabIndex)).toEqual([-1, 0, -1])

    radio('B').focus()
    fireEvent.keyDown(radio('B'), { key: 'ArrowRight' })
    expect(radio('C').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radio('C'))
    expect(radio('C').tabIndex).toBe(0)

    fireEvent.keyDown(radio('C'), { key: 'ArrowDown' })
    expect(radio('A').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radio('A'))

    fireEvent.keyDown(radio('A'), { key: 'ArrowUp' })
    expect(radio('C').getAttribute('aria-checked')).toBe('true')

    fireEvent.keyDown(radio('C'), { key: 'Home' })
    expect(radio('A').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radio('A'))
  })
})
