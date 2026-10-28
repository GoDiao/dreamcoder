import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { FormSelect } from './FormSelect'
import { Modal } from './Modal'

afterEach(cleanup)

function SelectionForm() {
  const [value, setValue] = useState('model-a')
  return <Modal open onClose={() => {}} title="Model settings">
    <FormSelect label="Fast model" value={value} onChange={setValue} options={[{ value: '', label: 'Use selected model' }, { value: 'model-a', label: 'Model A' }]} />
    <output>{value || 'default'}</output>
  </Modal>
}

describe('FormSelect', () => {
  it('supports the empty application value and returns focus inside its dialog', async () => {
    render(<SelectionForm />)
    const trigger = screen.getByRole('combobox', { name: 'Fast model' })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const option = await screen.findByRole('option', { name: 'Use selected model' })
    fireEvent.click(option)
    expect(screen.getByRole('status')).toHaveTextContent('default')
    expect(trigger).toHaveTextContent('Use selected model')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('ties the description to the trigger', () => {
    render(<FormSelect label="Auth" value="low" onChange={() => {}} description="Applies to requests" options={[{ value: 'low', label: 'Low' }]} />)
    expect(screen.getByRole('combobox', { name: 'Auth' })).toHaveAccessibleDescription('Applies to requests')
  })

  it('returns focus to the trigger only when closed from the keyboard', async () => {
    render(<FormSelect label="Effort" value="low" onChange={() => {}} options={[{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }]} />)
    const trigger = screen.getByRole('combobox', { name: 'Effort' })

    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(await screen.findByRole('listbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await screen.findByRole('listbox')
    await waitFor(() => {
      fireEvent.pointerDown(document.body, { button: 0, pointerType: 'mouse' })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
    expect(trigger).not.toHaveFocus()
  })
})
