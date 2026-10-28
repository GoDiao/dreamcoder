import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { SettingsDisclosureRow } from './SettingsDisclosureRow'

afterEach(cleanup)

it('links its shared trigger to the collapsible settings content', () => {
  render(<SettingsDisclosureRow title="Advanced" summary="Default"><input aria-label="Setting" /></SettingsDisclosureRow>)
  const trigger = screen.getByRole('button', { name: 'Advanced Default' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  const panel = document.getElementById(trigger.getAttribute('aria-controls')!)
  expect(panel).toContainElement(screen.getByRole('textbox', { name: 'Setting' }))
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(trigger)
  expect(screen.queryByRole('textbox')).toBeNull()
})
