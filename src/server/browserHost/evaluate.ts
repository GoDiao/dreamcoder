import { BrowserHostError } from './hostChannel.js'
import { isRecord } from './snapshot/snapshotter.js'
import type { CdpSend } from './snapshot/types.js'

export const EVALUATE_TIMEOUT_MS = 5_000

export type EvaluateFailureReason = 'exception' | 'not_serializable' | 'timeout'

export type EvaluateOutcome =
  | { ok: true; json: string }
  | { ok: false; reason: EvaluateFailureReason; detail: string }

const NOT_SERIALIZABLE_ERROR = /couldn't be returned by value|reference chain is too long|circular/i
const TIMED_OUT = /Script execution timed out|Execution was terminated/i
const MATERIALIZE = 'function () { return this }'
const UNCONVERTIBLE = 'a value that cannot be converted to JSON, such as a cyclic object'

function malformed(what: string): Error {
  return new Error(`Browser evaluate: unexpected ${what} from the page`)
}

function notSerializable(what: string): EvaluateOutcome {
  return {
    ok: false,
    reason: 'not_serializable',
    detail: `The result is ${what}, which cannot be returned as data. Return plain data instead: strings, numbers, booleans, arrays and plain objects, for example element.textContent or an object that holds just the fields you need.`,
  }
}

function describeException(details: Record<string, unknown>): string {
  const exception = isRecord(details.exception) ? details.exception : null
  if (exception && typeof exception.description === 'string' && exception.description) return exception.description
  if (exception && 'value' in exception) return `Uncaught ${JSON.stringify(exception.value)}`
  return typeof details.text === 'string' && details.text ? details.text : 'The expression threw an exception.'
}

function readString(value: unknown, path: string[], what: string): string {
  let current: unknown = value
  for (const key of path) {
    if (!isRecord(current)) throw malformed(what)
    current = current[key]
  }
  if (typeof current !== 'string' || current === '') throw malformed(what)
  return current
}

function readBackendNodeId(value: unknown): number {
  if (isRecord(value) && isRecord(value.node) && typeof value.node.backendNodeId === 'number') return value.node.backendNodeId
  throw malformed('node description')
}

export async function evaluateInPage(
  cdp: CdpSend,
  expression: string,
  elementObjectId: string | null,
  timeoutMs: number = EVALUATE_TIMEOUT_MS,
): Promise<EvaluateOutcome> {
  const timeoutDetail = `The expression did not finish within ${timeoutMs}ms.`
  const held: string[] = elementObjectId === null ? [] : [elementObjectId]

  const materialize = async (objectId: string): Promise<EvaluateOutcome> => {
    try {
      const response = await cdp('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: MATERIALIZE,
        returnByValue: true,
        userGesture: false,
      })
      if (!isRecord(response)) throw malformed('serialization response')
      if (isRecord(response.exceptionDetails)) return notSerializable(UNCONVERTIBLE)
      if (!isRecord(response.result)) throw malformed('serialization response')
      return { ok: true, json: JSON.stringify(response.result.value) ?? 'undefined' }
    } catch (error) {
      if (error instanceof BrowserHostError && NOT_SERIALIZABLE_ERROR.test(error.message)) {
        return notSerializable(UNCONVERTIBLE)
      }
      throw error
    }
  }

  const read = async (response: unknown): Promise<EvaluateOutcome> => {
    if (!isRecord(response)) throw malformed('evaluate response')
    if (isRecord(response.exceptionDetails)) {
      const detail = describeException(response.exceptionDetails)
      return TIMED_OUT.test(detail)
        ? { ok: false, reason: 'timeout', detail: timeoutDetail }
        : { ok: false, reason: 'exception', detail }
    }
    const remote = response.result
    if (!isRecord(remote)) throw malformed('evaluate response')
    if (remote.type === 'undefined') return { ok: true, json: 'undefined' }
    if (remote.type === 'function') return notSerializable('a function')
    if (remote.type === 'symbol') return notSerializable('a symbol')
    if (remote.subtype === 'node') return notSerializable('a DOM node')
    if (typeof remote.unserializableValue === 'string') return { ok: true, json: remote.unserializableValue }
    if ('value' in remote) return { ok: true, json: JSON.stringify(remote.value) ?? 'undefined' }
    const objectId = readString(remote, ['objectId'], 'result object')
    held.push(objectId)
    return materialize(objectId)
  }

  const execute = async (): Promise<EvaluateOutcome> => {
    if (elementObjectId === null) {
      return read(
        await cdp('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          userGesture: false,
          timeout: timeoutMs,
        }),
      )
    }
    const backendNodeId = readBackendNodeId(await cdp('DOM.describeNode', { objectId: elementObjectId }))
    const objectId = readString(await cdp('DOM.resolveNode', { backendNodeId }), ['object', 'objectId'], 'resolved node')
    held.push(objectId)
    return read(
      await cdp('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: expression,
        arguments: [{ objectId }],
        awaitPromise: true,
        userGesture: false,
      }),
    )
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<EvaluateOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout', detail: timeoutDetail }), timeoutMs)
  })
  const work = execute()
  work.catch(() => undefined)
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
    for (const objectId of held) void cdp('Runtime.releaseObject', { objectId }).catch(() => undefined)
  }
}
