export type ReactProgramResult = {
  components: string[]
  props: unknown
  truncated: boolean
} | null

export function reactProgram(this: Element): ReactProgramResult {
  const MAX_COMPONENTS = 5
  const MAX_DEPTH = 3
  const MAX_KEYS = 20
  const MAX_ITEMS = 10
  const MAX_STRING = 100
  const MAX_JSON = 800
  const MAX_NAME = 80
  const SECRET_KEY = /token|secret|password|passwd|auth|credential|cookie|session|key/i
  const REDACTED = '[redacted]'

  type Fiber = {
    type?: unknown
    return?: Fiber | null
    memoizedProps?: unknown
  }

  const host = this as unknown as Record<string, unknown>
  const fiberKey = Object.keys(host).find(
    (key) => key.indexOf('__reactFiber$') === 0 || key.indexOf('__reactInternalInstance$') === 0,
  )
  if (!fiberKey) return null

  const nameOf = (type: unknown): string => {
    if (typeof type === 'function') {
      const named = type as { displayName?: unknown; name?: unknown }
      const label = typeof named.displayName === 'string' && named.displayName ? named.displayName : named.name
      return typeof label === 'string' ? label : ''
    }
    if (typeof type === 'object' && type !== null) {
      const wrapped = type as { displayName?: unknown; render?: unknown; type?: unknown }
      if (typeof wrapped.displayName === 'string' && wrapped.displayName) return wrapped.displayName
      if (wrapped.render) return nameOf(wrapped.render)
      if (wrapped.type) return nameOf(wrapped.type)
    }
    return ''
  }

  const components: string[] = []
  let nearestProps: unknown
  let found = false
  let fiber: Fiber | null | undefined = host[fiberKey] as Fiber | undefined
  while (fiber && components.length < MAX_COMPONENTS) {
    const type = fiber.type
    if (typeof type !== 'string') {
      const name = nameOf(type)
      if (name) {
        components.push(name.slice(0, MAX_NAME))
        if (!found) {
          found = true
          nearestProps = fiber.memoizedProps
        }
      }
    }
    fiber = fiber.return
  }
  if (components.length === 0) return null

  let truncated = false
  const seen = new WeakSet<object>()
  const clean = (value: unknown, key: string, depth: number): unknown => {
    if (SECRET_KEY.test(key)) return REDACTED
    if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) return undefined
    if (typeof value === 'string') {
      if (value.length > MAX_STRING) {
        truncated = true
        return value.slice(0, MAX_STRING)
      }
      return value
    }
    if (typeof value === 'bigint') return String(value)
    if (typeof value !== 'object' || value === null) return value
    const node = value as { $$typeof?: unknown; nodeType?: unknown }
    if (node.$$typeof) return '[element]'
    if (typeof node.nodeType === 'number') return '[node]'
    if (seen.has(value)) return '[circular]'
    if (depth >= MAX_DEPTH) {
      truncated = true
      return '[object]'
    }
    seen.add(value)
    let result: unknown
    if (Array.isArray(value)) {
      if (value.length > MAX_ITEMS) truncated = true
      result = value.slice(0, MAX_ITEMS).map((item) => {
        const cleaned = clean(item, '', depth + 1)
        return cleaned === undefined ? null : cleaned
      })
    } else {
      const output: Record<string, unknown> = {}
      const keys = Object.keys(value)
      if (keys.length > MAX_KEYS) truncated = true
      for (const name of keys.slice(0, MAX_KEYS)) {
        let child: unknown
        try {
          child = (value as Record<string, unknown>)[name]
        } catch (error) {
          continue
        }
        const cleaned = clean(child, name, depth + 1)
        if (cleaned !== undefined) output[name] = cleaned
      }
      result = output
    }
    seen.delete(value)
    return result
  }

  let props: unknown = null
  if (typeof nearestProps === 'object' && nearestProps !== null) {
    const cleaned = clean(nearestProps, '', 0)
    const json = JSON.stringify(cleaned)
    if (json !== undefined) {
      if (json.length <= MAX_JSON) {
        props = cleaned
      } else {
        truncated = true
        props = json.slice(0, MAX_JSON)
      }
    }
  }
  return { components, props, truncated }
}
