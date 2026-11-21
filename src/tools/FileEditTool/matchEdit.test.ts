import { describe, expect, it } from 'bun:test'
import { matchEdit } from './matchEdit.js'

const NOT_FOUND = 0

describe('exact match', () => {
  it('returns the strings unchanged and counts every occurrence', () => {
    expect(matchEdit('a = 1\nb = 1\n', '= 1', '= 2', false)).toEqual({ oldString: '= 1', newString: '= 2', matches: 2 })
    expect(matchEdit('a = 1\nb = 1\n', 'a = 1', 'a = 2', false)).toEqual({ oldString: 'a = 1', newString: 'a = 2', matches: 1 })
  })

  it('wins over a looser strategy that would also match', () => {
    const file = '12\tfoo\nfoo\n'
    expect(matchEdit(file, '12\tfoo', 'bar', false)).toEqual({ oldString: '12\tfoo', newString: 'bar', matches: 1 })
  })

  it('treats an empty old_string as a single match', () => {
    expect(matchEdit('', '', 'new file', false)).toEqual({ oldString: '', newString: 'new file', matches: 1 })
  })

  it('reports no match with the inputs unchanged', () => {
    expect(matchEdit('alpha\n', 'beta', 'gamma', false)).toEqual({ oldString: 'beta', newString: 'gamma', matches: NOT_FOUND })
  })
})

describe('sanitized tags', () => {
  it('restores tags the API shortened and applies the same change to new_string', () => {
    const file = '<function_results>\nok\n</function_results>\n'
    expect(matchEdit(file, '<fnr>\nok', '<fnr>\ndone', false)).toEqual({ oldString: '<function_results>\nok', newString: '<function_results>\ndone', matches: 1 })
  })

  it('is available with replace_all', () => {
    expect(matchEdit('<name>a</name> <name>a</name>\n', '<n>a</n>', '<n>b</n>', true)).toEqual({ oldString: '<name>a</name>', newString: '<name>b</name>', matches: 2 })
  })
})

describe('curly quotes', () => {
  it('finds straight quotes written for curly ones and keeps the file style in new_string', () => {
    const file = 'title = \u201CHello\u201D\n'
    expect(matchEdit(file, 'title = "Hello"', 'title = "Goodbye"', false)).toEqual({
      oldString: 'title = \u201CHello\u201D',
      newString: 'title = \u201CGoodbye\u201D',
      matches: 1,
    })
  })

  it('keeps an apostrophe inside a word as a closing quote', () => {
    const file = 'say \u2018hi\u2019\n'
    expect(matchEdit(file, "say 'hi'", "say 'don't'", false).newString).toBe('say \u2018don\u2019t\u2019')
  })

  it('leaves new_string alone when the file has the straight quotes', () => {
    const file = 'title = "Hello"\n'
    expect(matchEdit(file, 'title = \u201CHello\u201D', 'title = "Bye"', false)).toEqual({ oldString: 'title = "Hello"', newString: 'title = "Bye"', matches: 1 })
  })

  it('counts candidates whose quote styles differ', () => {
    expect(matchEdit('\u201Ca\u201D x \u201Ca"\n', '"a"', '"b"', false).matches).toBe(2)
  })

  it('counts every candidate', () => {
    const file = '\u201Ca\u201D and \u201Ca\u201D\n'
    expect(matchEdit(file, '"a"', '"b"', false).matches).toBe(2)
    expect(matchEdit(file, '"a"', '"b"', true)).toEqual({ oldString: '\u201Ca\u201D', newString: '\u201Cb\u201D', matches: 2 })
  })
})

describe('line number prefixes', () => {
  const file = 'def f():\n    return 1\n\ndef g():\n    return 2\n'

  it('strips the tab form from both strings', () => {
    expect(matchEdit(file, '1\tdef f():\n2\t    return 1', '1\tdef f():\n2\t    return 3', false)).toEqual({
      oldString: 'def f():\n    return 1',
      newString: 'def f():\n    return 3',
      matches: 1,
    })
  })

  it('strips the padded arrow form', () => {
    expect(matchEdit(file, '     4\u2192def g():\n     5\u2192    return 2', 'def g():\n    return 4', false)).toEqual({
      oldString: 'def g():\n    return 2',
      newString: 'def g():\n    return 4',
      matches: 1,
    })
  })

  it('reads a bare number between prefixed lines as an empty line', () => {
    expect(matchEdit(file, '2\t    return 1\n3\n4\tdef g():', '2\t    return 1\n3\n4\tdef h():', false)).toEqual({
      oldString: '    return 1\n\ndef g():',
      newString: '    return 1\n\ndef h():',
      matches: 1,
    })
  })

  it('keeps a trailing newline', () => {
    expect(matchEdit(file, '5\t    return 2\n', '5\t    return 5\n', false)).toEqual({ oldString: '    return 2\n', newString: '    return 5\n', matches: 1 })
  })

  it('leaves new_string alone when none of its lines carry a prefix', () => {
    expect(matchEdit(file, '2\t    return 1', '    x = 1\n    return 1', false)).toEqual({ oldString: '    return 1', newString: '    x = 1\n    return 1', matches: 1 })
  })

  it('does not match when only some lines of new_string carry a prefix', () => {
    expect(matchEdit(file, '2\t    return 1', '    x = 1\n2\t    return 1', false).matches).toBe(NOT_FOUND)
  })

  it('reads an empty line between prefixed lines as an empty line', () => {
    expect(matchEdit(file, '1\tdef f():\n2\t    return 1', '1\tdef f():\n\n2\t    return 1', false)).toEqual({
      oldString: 'def f():\n    return 1',
      newString: 'def f():\n\n    return 1',
      matches: 1,
    })
  })

  it('does not apply when a line of old_string has no prefix', () => {
    expect(matchEdit(file, '1\tdef f():\n    return 9', 'x', false).matches).toBe(NOT_FOUND)
  })

  it('does not apply to bare numbers alone', () => {
    expect(matchEdit(file, '7', 'x', false).matches).toBe(NOT_FOUND)
  })

  it('is available with replace_all and counts every occurrence', () => {
    const repeated = 'x = 1\ny = 2\nx = 1\n'
    expect(matchEdit(repeated, '1\tx = 1', '1\tx = 0', true)).toEqual({ oldString: 'x = 1', newString: 'x = 0', matches: 2 })
    expect(matchEdit(repeated, '1\tx = 1', '1\tx = 0', false).matches).toBe(2)
  })
})

describe('trailing whitespace', () => {
  const file = 'first  \nsecond\t\n   \nthird\n'

  it('ignores whitespace at the end of each line and leaves new_string alone', () => {
    expect(matchEdit(file, 'first\nsecond\n\nthird', 'first\nchanged  \n\nthird', false)).toEqual({
      oldString: 'first  \nsecond\t\n   \nthird',
      newString: 'first\nchanged  \n\nthird',
      matches: 1,
    })
  })

  it('ignores extra whitespace at the end of old_string lines', () => {
    expect(matchEdit('alpha\nbeta\n', 'alpha  \nbeta', 'gamma', false)).toEqual({ oldString: 'alpha\nbeta', newString: 'gamma', matches: 1 })
  })

  it('takes the newline after the block when old_string ends with one', () => {
    expect(matchEdit(file, 'first\nsecond\n', 'only\n', false)).toEqual({ oldString: 'first  \nsecond\t\n', newString: 'only\n', matches: 1 })
  })

  it('does not match a block at the end of a file that has no final newline when old_string ends with one', () => {
    expect(matchEdit('a  \nb  ', 'a\nb\n', 'c\n', false).matches).toBe(NOT_FOUND)
  })

  it('does not ignore whitespace inside a line', () => {
    expect(matchEdit('a  =  1  \n', 'a = 1', 'a = 2', false).matches).toBe(NOT_FOUND)
  })

  it('reports every candidate', () => {
    expect(matchEdit('x  \ny\nx \ny\n', 'x\ny', 'z', false).matches).toBe(2)
  })

  it('reports several matches when the text of the only block also occurs inside earlier lines', () => {
    expect(matchEdit('xa\nbz\na\nb\n', 'a \nb', 'c', false)).toEqual({ oldString: 'a\nb', newString: 'c', matches: 2 })
  })

  it('counts an earlier occurrence that overlaps the block', () => {
    expect(matchEdit('ax\nx\nx\n', 'x \nx', 'y', false).matches).toBe(2)
  })

  it('is not used with replace_all', () => {
    expect(matchEdit(file, 'first\nsecond', 'x', true).matches).toBe(NOT_FOUND)
  })
})

describe('indentation', () => {
  const nested = 'class A:\n    def f(self):\n        if x:\n            return 1\n\n        return 2\n'

  it('accepts lines that all miss the same prefix and adds it to new_string', () => {
    expect(matchEdit(nested, 'if x:\n    return 1\n\nreturn 2', 'if y:\n    return 3\n\nreturn 2', false)).toEqual({
      oldString: '        if x:\n            return 1\n\n        return 2',
      newString: '        if y:\n            return 3\n\n        return 2',
      matches: 1,
    })
  })

  it('accepts lines that all carry the same extra prefix and removes it from new_string', () => {
    expect(matchEdit(nested, '            if x:\n                return 1', '            if x:\n                return 9', false)).toEqual({
      oldString: '        if x:\n            return 1',
      newString: '        if x:\n            return 9',
      matches: 1,
    })
  })

  it('rejects the match when a new_string line is indented less than the extra prefix', () => {
    expect(matchEdit(nested, '            if x:\n                return 1', '  if x:\n      return 9', false).matches).toBe(NOT_FOUND)
  })

  it('accepts spaces written for tabs at one width and converts new_string', () => {
    const tabbed = 'func f() {\n\tif x {\n\t\treturn 1\n\t}\n}\n'
    expect(matchEdit(tabbed, '    if x {\n        return 1\n    }', '    if y {\n        return 2\n          + aligned\n    }', false)).toEqual({
      oldString: '\tif x {\n\t\treturn 1\n\t}',
      newString: '\tif y {\n\t\treturn 2\n\t\t  + aligned\n\t}',
      matches: 1,
    })
  })

  it('accepts tabs written for spaces at one width and converts new_string', () => {
    const spaced = 'function f() {\n  if (x) {\n    return 1\n  }\n}\n'
    expect(matchEdit(spaced, '\tif (x) {\n\t\treturn 1\n\t}', '\tif (y) {\n\t\treturn 2\n\t}', false)).toEqual({
      oldString: '  if (x) {\n    return 1\n  }',
      newString: '  if (y) {\n    return 2\n  }',
      matches: 1,
    })
  })

  it('rejects the match when a new_string line mixes in the other indent character', () => {
    const tabbed = 'func f() {\n\tif x {\n\t\treturn 1\n\t}\n}\n'
    expect(matchEdit(tabbed, '    if x {\n        return 1\n    }', '    if y {\n\t\treturn 2\n    }', false).matches).toBe(NOT_FOUND)
  })

  it('rejects indentation that differs by a different amount on each line', () => {
    expect(matchEdit(nested, '  if x:\n    return 1', '  if x:\n    return 9', false).matches).toBe(NOT_FOUND)
  })

  it('rejects a tab and space swap whose width changes between lines', () => {
    const tabbed = '\tif x {\n\t\treturn 1\n\t}\n'
    expect(matchEdit(tabbed, '  if x {\n      return 1\n  }', 'x', false).matches).toBe(NOT_FOUND)
  })

  it('rejects a swap combined with a missing prefix', () => {
    const tabbed = '\t\tif x {\n\t\t\treturn 1\n\t\t}\n'
    expect(matchEdit(tabbed, 'if x {\n    return 1\n}', 'x', false).matches).toBe(NOT_FOUND)
  })

  it('does not ignore whitespace at the end of a line', () => {
    expect(matchEdit('  a = 1  \n  b = 2\n', 'a = 1\nb = 2', 'x', false).matches).toBe(NOT_FOUND)
  })

  it('reports every candidate', () => {
    const repeated = '    a()\n    b()\n        a()\n        b()\n'
    expect(matchEdit(repeated, '  a()\n  b()', 'x', false).matches).toBe(2)
  })

  it('reports several matches when the text of the only block also occurs inside an earlier line', () => {
    const file = 'if (a)   return null\nlog()\n  return null\n'
    expect(matchEdit(file, '\treturn null', '\treturn 1', false)).toEqual({ oldString: '  return null', newString: '  return 1', matches: 2 })
  })

  it('is not used with replace_all', () => {
    expect(matchEdit(nested, 'if x:\n    return 1', 'x', true).matches).toBe(NOT_FOUND)
  })
})

describe('escapes', () => {
  it('reads escapes written out in old_string and new_string', () => {
    const file = 'print("a")\n\tprint(\'b\')\npath = "C:\\\\dir"\n'
    expect(matchEdit(file, 'print(\\"a\\")\\n\\tprint(\\\'b\\\')', 'print(\\"c\\")\\n\\tprint(\\\'d\\\')', false)).toEqual({
      oldString: 'print("a")\n\tprint(\'b\')',
      newString: 'print("c")\n\tprint(\'d\')',
      matches: 1,
    })
  })

  it('reads a doubled backslash as one', () => {
    const file = 'pattern = /a\\d/\n'
    expect(matchEdit(file, 'pattern = /a\\\\d/', 'pattern = /b\\\\d\\\\n/', false)).toEqual({
      oldString: 'pattern = /a\\d/',
      newString: 'pattern = /b\\d\\n/',
      matches: 1,
    })
  })

  it('does not apply when old_string has no escape', () => {
    expect(matchEdit('a\nb\n', 'a b', 'c', false).matches).toBe(NOT_FOUND)
  })

  it('reports every candidate', () => {
    expect(matchEdit('say "x"\nsay "x"\n', 'say \\"x\\"', 'y', false).matches).toBe(2)
  })

  it('is not used with replace_all', () => {
    expect(matchEdit('say "x"\n', 'say \\"x\\"', 'y', true).matches).toBe(NOT_FOUND)
  })
})

describe('strategies are tried one at a time', () => {
  it('does not combine a line number prefix with an indentation fix', () => {
    const file = '    if x:\n        return 1\n'
    expect(matchEdit(file, '1\tif x:\n2\t    return 1', 'x', false).matches).toBe(NOT_FOUND)
  })

  it('stops at the first strategy that has a candidate', () => {
    const file = 'a  \nb\n\ta\n\tb\n'
    expect(matchEdit(file, 'a\nb', 'c', false)).toEqual({ oldString: 'a  \nb', newString: 'c', matches: 1 })
  })
})
