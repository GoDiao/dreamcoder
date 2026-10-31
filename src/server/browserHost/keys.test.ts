import { describe, expect, test } from 'bun:test'
import { parseKeyChord } from './keys.js'

describe('parseKeyChord', () => {
  test('parses named keys, letters, digits and function keys', () => {
    expect(parseKeyChord('Enter')?.spec).toMatchObject({ key: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    expect(parseKeyChord('a')?.spec).toMatchObject({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, text: 'a' })
    expect(parseKeyChord('7')?.spec).toMatchObject({ code: 'Digit7', text: '7' })
    expect(parseKeyChord('F5')?.spec).toMatchObject({ key: 'F5', windowsVirtualKeyCode: 116 })
    expect(parseKeyChord('escape')?.spec.key).toBe('Escape')
  })

  test('combines modifiers into the bit mask and drops text for shortcuts', () => {
    const chord = parseKeyChord('Control+Shift+a')
    expect(chord?.modifiers).toBe(2 | 8)
    expect(chord?.spec.text).toBeUndefined()
    expect(parseKeyChord('Cmd+A')?.modifiers).toBe(4)
    expect(parseKeyChord('Alt+ArrowLeft')?.modifiers).toBe(1)
  })

  test('shift alone upper-cases a typed letter', () => {
    expect(parseKeyChord('Shift+a')?.spec).toMatchObject({ key: 'A', text: 'A' })
  })

  test('rejects junk', () => {
    expect(parseKeyChord('')).toBeNull()
    expect(parseKeyChord('Banana')).toBeNull()
    expect(parseKeyChord('Ctrl+')).toBeNull()
    expect(parseKeyChord('Hyper+a')).toBeNull()
    expect(parseKeyChord('F13')).toBeNull()
  })
})
