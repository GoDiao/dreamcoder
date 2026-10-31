import { describe, expect, test } from 'vitest'
import { reactProgram, type ReactProgramResult } from '../../../src/server/browserHost/snapshot/reactProgram'

type Fiber = { type?: unknown; return?: Fiber | null; memoizedProps?: unknown }

function elementWith(fiber: Fiber | null, key = '__reactFiber$abc123'): Element {
  const element = document.createElement('button')
  if (fiber) (element as unknown as Record<string, unknown>)[key] = fiber
  return element
}

function chain(...fibers: Fiber[]): Fiber {
  for (let i = 0; i < fibers.length - 1; i += 1) (fibers[i] as Fiber).return = fibers[i + 1] as Fiber
  return fibers[0] as Fiber
}

function component(name: string, props: unknown = {}): Fiber {
  const type = function () {
    return null
  }
  Object.defineProperty(type, 'name', { value: name })
  return { type, memoizedProps: props }
}

function readFrom(element: Element): ReactProgramResult {
  return reactProgram.call(element)
}

function props(result: ReactProgramResult): unknown {
  return result ? result.props : undefined
}

describe('react program: components', () => {
  test('has nothing for an element that React does not own', () => {
    expect(readFrom(elementWith(null))).toBeNull()
  })

  test('has nothing when no component sits above the host element', () => {
    expect(readFrom(elementWith(chain({ type: 'button' }, { type: 'div' })))).toBeNull()
  })

  test('lists the nearest component names and skips host elements', () => {
    const fiber = chain({ type: 'button' }, component('Buy'), { type: 'div' }, component('Card'), component('Page'))
    expect(readFrom(elementWith(fiber))?.components).toEqual(['Buy', 'Card', 'Page'])
  })

  test('stops at five names', () => {
    const fibers = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => component(name))
    expect(readFrom(elementWith(chain({ type: 'span' }, ...fibers)))?.components).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  test('prefers a display name and unwraps memo and forwardRef types', () => {
    const named = component('inner')
    ;(named.type as { displayName?: string }).displayName = 'Pretty'
    const memo: Fiber = { type: { type: component('Memoed').type }, memoizedProps: {} }
    const forwarded: Fiber = { type: { render: component('Forwarded').type }, memoizedProps: {} }
    const anonymous = component('')
    Object.defineProperty(anonymous.type, 'name', { value: '' })
    const fiber = chain({ type: 'i' }, named, memo, forwarded, anonymous, component('Root'))
    expect(readFrom(elementWith(fiber))?.components).toEqual(['Pretty', 'Memoed', 'Forwarded', 'Root'])
  })

  test('also understands the older internal instance key', () => {
    const fiber = chain({ type: 'i' }, component('Legacy'))
    expect(readFrom(elementWith(fiber, '__reactInternalInstance$xyz'))?.components).toEqual(['Legacy'])
  })

  test('cuts long names', () => {
    const result = readFrom(elementWith(chain({ type: 'i' }, component('N'.repeat(200)))))
    expect(result?.components[0]).toHaveLength(80)
  })
})

describe('react program: props', () => {
  test('returns the props of the nearest component as plain data', () => {
    const fiber = chain({ type: 'i' }, component('Buy', { label: 'Buy', size: 3, ok: true, nothing: null }), component('Page', { other: 1 }))
    const result = readFrom(elementWith(fiber))
    expect(result?.props).toEqual({ label: 'Buy', size: 3, ok: true, nothing: null })
    expect(result?.truncated).toBe(false)
  })

  test('omits functions and undefined values', () => {
    const fiber = chain({ type: 'i' }, component('Buy', { onClick: () => 1, gone: undefined, label: 'x', tag: Symbol('s') }))
    expect(props(readFrom(elementWith(fiber)))).toEqual({ label: 'x' })
  })

  test('cuts strings at 100 characters and flags it', () => {
    const fiber = chain({ type: 'i' }, component('Buy', { text: 'a'.repeat(250) }))
    const result = readFrom(elementWith(fiber))
    expect((result?.props as { text: string }).text).toHaveLength(100)
    expect(result?.truncated).toBe(true)
  })

  test('replaces values of sensitive keys, at any depth and in any case', () => {
    const fiber = chain(
      { type: 'i' },
      component('Login', {
        apiKey: 'k-1',
        Authorization: 'Bearer x',
        user: { password: 'pw', name: 'ada', nested: { sessionId: 's1', csrfToken: 't', passwd: 'q', credentials: { a: 1 } } },
        cookie: 'c=1',
        title: 'safe',
      }),
    )
    const result = readFrom(elementWith(fiber))
    expect(result?.props).toEqual({
      apiKey: '[redacted]',
      Authorization: '[redacted]',
      user: { password: '[redacted]', name: 'ada', nested: { sessionId: '[redacted]', csrfToken: '[redacted]', passwd: '[redacted]', credentials: '[redacted]' } },
      cookie: '[redacted]',
      title: 'safe',
    })
    expect(JSON.stringify(result)).not.toMatch(/k-1|Bearer|"pw"|s1|c=1/)
  })

  test('stops at depth three', () => {
    const fiber = chain({ type: 'i' }, component('Deep', { a: { b: { c: { d: 1 } } } }))
    const result = readFrom(elementWith(fiber))
    expect(result?.props).toEqual({ a: { b: { c: '[object]' } } })
    expect(result?.truncated).toBe(true)
  })

  test('survives circular structures', () => {
    const loop: Record<string, unknown> = { name: 'loop' }
    loop.self = loop
    loop.list = [loop]
    const result = readFrom(elementWith(chain({ type: 'i' }, component('Loop', { loop }))))
    expect(result?.props).toEqual({ loop: { name: 'loop', self: '[circular]', list: ['[circular]'] } })
  })

  test('summarises React elements and DOM nodes instead of walking them', () => {
    const fiber = chain(
      { type: 'i' },
      component('Box', { children: { $$typeof: Symbol.for('react.element'), type: 'div', props: { big: 'x' } }, node: document.body }),
    )
    expect(props(readFrom(elementWith(fiber)))).toEqual({ children: '[element]', node: '[node]' })
  })

  test('limits keys and array items', () => {
    const many: Record<string, number> = {}
    for (let i = 0; i < 30; i += 1) many[`k${i}`] = i
    const result = readFrom(elementWith(chain({ type: 'i' }, component('Many', { many, list: Array.from({ length: 25 }, (_v, i) => i) }))))
    const value = result?.props as { many: Record<string, number>; list: number[] } | string
    expect(typeof value === 'string' ? value.length : Object.keys(value.many).length).toBeGreaterThan(0)
    expect(result?.truncated).toBe(true)
    if (typeof value !== 'string') {
      expect(Object.keys(value.many)).toHaveLength(20)
      expect(value.list).toHaveLength(10)
    }
  })

  test('returns the JSON text cut at 800 characters when the props do not fit', () => {
    const wide: Record<string, string> = {}
    for (let i = 0; i < 20; i += 1) wide[`field${i}`] = 'v'.repeat(90)
    const result = readFrom(elementWith(chain({ type: 'i' }, component('Wide', wide))))
    expect(typeof result?.props).toBe('string')
    expect(result?.props as string).toHaveLength(800)
    expect(result?.truncated).toBe(true)
  })

  test('has no props for a component without an object of props', () => {
    expect(props(readFrom(elementWith(chain({ type: 'i' }, component('Bare', null)))))).toBeNull()
  })

  test('does not fail on a getter that throws', () => {
    const hostile = {}
    Object.defineProperty(hostile, 'boom', { enumerable: true, get: () => { throw new Error('boom') } })
    Object.defineProperty(hostile, 'ok', { enumerable: true, value: 1 })
    expect(props(readFrom(elementWith(chain({ type: 'i' }, component('Hostile', hostile)))))).toEqual({ ok: 1 })
  })
})

describe('react program: self-containedness', () => {
  test('source references nothing outside its own body and has no compiler helpers', () => {
    const source = reactProgram.toString()
    expect(source.startsWith('function')).toBe(true)
    expect(source).not.toMatch(/__name|__publicField|__spread|__rest|_define_property|__defProp|__async/)
    expect(source).not.toMatch(/\bimport\b|\brequire\b/)
  })

  test('runs as a bare function declaration with the element as this', () => {
    const fiber = chain({ type: 'i' }, component('Isolated', { a: 1 }))
    const run = new Function(`return (${reactProgram.toString()}).call(arguments[0])`) as (element: Element) => ReactProgramResult
    expect(run.call(null, elementWith(fiber))).toEqual({ components: ['Isolated'], props: { a: 1 }, truncated: false })
  })
})
