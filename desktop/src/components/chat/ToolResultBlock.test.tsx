import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { ToolResultBlock } from './ToolResultBlock'
import { useSettingsStore } from '../../stores/settingsStore'

const settings = useSettingsStore.getState()
afterEach(() => { cleanup(); useSettingsStore.setState(settings, true) })

it('expands and collapses long error output through the shared controls', () => {
  useSettingsStore.setState({ locale: 'en' })
  const content = 'failure details '.repeat(30)
  render(<ToolResultBlock content={content} isError toolName="Bash" />)
  const trigger = screen.getByRole('button', { expanded: false })
  expect(trigger).toHaveAttribute('data-slot', 'button')
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText(content.trim())).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Show less/i }))
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
