export type KeyEventSpec = {
  key: string
  code: string
  windowsVirtualKeyCode: number
  text?: string
}

export type KeyChord = {
  modifiers: number
  spec: KeyEventSpec
}

const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  option: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
}

const NAMED_KEYS: Record<string, KeyEventSpec> = {
  enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  end: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
}

function singleCharacterKey(character: string): KeyEventSpec | null {
  if (/^[a-z]$/i.test(character)) {
    const upper = character.toUpperCase()
    return { key: character, code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0), text: character }
  }
  if (/^[0-9]$/.test(character)) {
    return { key: character, code: `Digit${character}`, windowsVirtualKeyCode: character.charCodeAt(0), text: character }
  }
  return null
}

function functionKey(name: string): KeyEventSpec | null {
  const match = /^f([1-9]|1[0-2])$/i.exec(name)
  if (!match) return null
  const number = Number(match[1])
  return { key: `F${number}`, code: `F${number}`, windowsVirtualKeyCode: 111 + number }
}

export function parseKeyChord(input: string): KeyChord | null {
  const parts = input.split('+').map((part) => part.trim())
  if (parts.length === 0 || parts.some((part) => part === '')) return null
  const keyName = parts[parts.length - 1]!
  let modifiers = 0
  for (const part of parts.slice(0, -1)) {
    const bit = MODIFIER_BITS[part.toLowerCase()]
    if (bit === undefined) return null
    modifiers |= bit
  }
  const spec = NAMED_KEYS[keyName.toLowerCase()] ?? functionKey(keyName) ?? singleCharacterKey(keyName)
  if (!spec) return null
  const typesText = (modifiers & (1 | 2 | 4)) === 0 && spec.text !== undefined
  const shifted = (modifiers & 8) !== 0 && /^[a-z]$/i.test(spec.key)
  if (!typesText) return { modifiers, spec: { ...spec, text: undefined } }
  return { modifiers, spec: shifted ? { ...spec, key: spec.key.toUpperCase(), text: spec.key.toUpperCase() } : spec }
}
