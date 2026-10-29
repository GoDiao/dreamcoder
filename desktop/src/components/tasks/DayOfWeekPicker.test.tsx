import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { DayOfWeekPicker } from './DayOfWeekPicker'
import { useSettingsStore } from '../../stores/settingsStore'

const settings = useSettingsStore.getState()
beforeEach(() => useSettingsStore.setState({ locale: 'en' }))
afterEach(() => { cleanup(); useSettingsStore.setState(settings, true) })

function Picker() {
  const [days, setDays] = useState([1])
  return <DayOfWeekPicker selected={days} onChange={setDays} />
}

describe('DayOfWeekPicker', () => {
  it('announces selected days and prevents removing the final day', async () => {
    render(<Picker />)
    const days = screen.getAllByRole('button')
    expect(days[0]).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(days[0]!)
    expect(days[0]).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(days[1]!)
    expect(days[1]).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(days[0]!)
    expect(days[0]).toHaveAttribute('aria-pressed', 'false')
    act(() => days[0]!.focus())
    fireEvent.keyDown(days[0]!, { key: 'ArrowRight' })
    await waitFor(() => expect(days[1]).toHaveFocus())
  })
})
