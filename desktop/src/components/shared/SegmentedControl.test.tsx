import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  it('focuses the selected option on entry and moves the selection with arrow keys', async () => {
    render(<Harness />)
    const radio = (name: string) => screen.getByRole('radio', { name })

    act(() => screen.getByRole('radiogroup').focus())
    await waitFor(() => expect(document.activeElement).toBe(radio('B')))
    fireEvent.keyDown(radio('B'), { key: 'ArrowRight' })
    await waitFor(() => expect(radio('C').getAttribute('aria-checked')).toBe('true'))
    expect(document.activeElement).toBe(radio('C'))
    expect(radio('C').tabIndex).toBe(0)

    fireEvent.keyDown(radio('C'), { key: 'ArrowDown' })
    await waitFor(() => expect(radio('A').getAttribute('aria-checked')).toBe('true'))
    expect(document.activeElement).toBe(radio('A'))

    fireEvent.keyDown(radio('A'), { key: 'ArrowUp' })
    await waitFor(() => expect(radio('C').getAttribute('aria-checked')).toBe('true'))

    fireEvent.keyDown(radio('C'), { key: 'Home' })
    await waitFor(() => expect(radio('A').getAttribute('aria-checked')).toBe('true'))
    expect(document.activeElement).toBe(radio('A'))
  })
})
