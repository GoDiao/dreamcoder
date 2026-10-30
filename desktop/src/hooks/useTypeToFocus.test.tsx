import { useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { useTypeToFocus } from './useTypeToFocus'

afterEach(cleanup)

function Composer({ enabled = true, disabled = false }: { enabled?: boolean; disabled?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useTypeToFocus(ref, enabled)
  return (
    <>
      <textarea ref={ref} aria-label="Message" disabled={disabled} />
      <button type="button">Model</button>
      <input aria-label="Search" />
      <button type="button" role="combobox" aria-label="Picker" />
      <div role="dialog"><button type="button">Inside dialog</button></div>
    </>
  )
}

describe('useTypeToFocus', () => {
  it('moves focus to the composer when a character is typed with no field focused', () => {
    render(<Composer />)
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
  })

  it('moves focus to the composer when a character is typed on a button', () => {
    render(<Composer />)
    const button = screen.getByRole('button', { name: 'Model' })
    button.focus()
    fireEvent.keyDown(button, { key: '/' })
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
  })

  it('leaves focus alone for shortcuts, non-character keys and space on a button', () => {
    render(<Composer />)
    const button = screen.getByRole('button', { name: 'Model' })
    button.focus()
    fireEvent.keyDown(button, { key: 'k', metaKey: true })
    fireEvent.keyDown(button, { key: 'Escape' })
    fireEvent.keyDown(button, { key: ' ' })
    fireEvent.keyDown(button, { key: 'a', isComposing: true })
    expect(button).toHaveFocus()
  })

  it('leaves focus on a select trigger', () => {
    render(<Composer />)
    const picker = screen.getByRole('combobox', { name: 'Picker' })
    picker.focus()
    fireEvent.keyDown(picker, { key: 'a' })
    expect(picker).toHaveFocus()
  })

  it('leaves focus in other fields and open dialogs', () => {
    render(<Composer />)
    const search = screen.getByRole('textbox', { name: 'Search' })
    search.focus()
    fireEvent.keyDown(search, { key: 'a' })
    expect(search).toHaveFocus()

    const inDialog = screen.getByRole('button', { name: 'Inside dialog' })
    inDialog.focus()
    fireEvent.keyDown(inDialog, { key: 'a' })
    expect(inDialog).toHaveFocus()
  })

  it('does nothing when disabled or when the composer is disabled', () => {
    const { unmount } = render(<Composer enabled={false} />)
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveFocus()
    unmount()

    render(<Composer disabled />)
    fireEvent.keyDown(document.body, { key: 'a' })
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveFocus()
  })
})
