import { describe, expect, test } from 'bun:test'
import { evaluateInPage } from './evaluate.js'
import type { CdpSend } from './snapshot/types.js'

type Call = { method: string; params: Record<string, unknown> | undefined }

function scripted(answer: (call: Call) => unknown | Promise<unknown>) {
  const calls: Call[] = []
  const cdp: CdpSend = async (method, params) => {
    const call = { method, params }
    calls.push(call)
    return answer(call)
  }
  return { cdp, calls }
}

describe('evaluateInPage', () => {
  test('gives up after the time limit and releases what it holds', async () => {
    const { cdp, calls } = scripted((call) => (call.method === 'Runtime.evaluate' ? new Promise(() => undefined) : {}))
    const outcome = await evaluateInPage(cdp, 'new Promise(() => {})', null, 20)
    expect(outcome).toEqual({ ok: false, reason: 'timeout', detail: 'The expression did not finish within 20ms.' })
    expect(calls[0]?.params).toMatchObject({ awaitPromise: true, userGesture: false, timeout: 20 })
  })

  test('a call that fails after the time limit does not raise an unhandled rejection', async () => {
    const { cdp } = scripted(
      (call) =>
        new Promise((_resolve, reject) => {
          if (call.method === 'Runtime.evaluate') setTimeout(() => reject(new Error('late failure')), 40)
        }),
    )
    const outcome = await evaluateInPage(cdp, 'x', null, 10)
    expect(outcome).toMatchObject({ ok: false, reason: 'timeout' })
    await new Promise((resolve) => setTimeout(resolve, 80))
  })

  test('maps the page engine terminating a long synchronous script to a timeout', async () => {
    const { cdp } = scripted(() => ({
      result: { type: 'object', subtype: 'error' },
      exceptionDetails: { text: 'Uncaught', exception: { type: 'object', description: 'Error: Script execution timed out.' } },
    }))
    expect(await evaluateInPage(cdp, 'while (true) {}', null)).toEqual({
      ok: false,
      reason: 'timeout',
      detail: 'The expression did not finish within 5000ms.',
    })
  })

  test('an exception without a description falls back to the engine text', async () => {
    const { cdp } = scripted(() => ({ result: { type: 'object' }, exceptionDetails: { text: 'Uncaught SyntaxError' } }))
    expect(await evaluateInPage(cdp, '}', null)).toEqual({ ok: false, reason: 'exception', detail: 'Uncaught SyntaxError' })
  })

  test('a failure to read the result object as data stays an error of the browser, not of the script', async () => {
    const { cdp } = scripted((call) => {
      if (call.method === 'Runtime.evaluate') return { result: { type: 'object', objectId: 'o1' } }
      if (call.method === 'Runtime.callFunctionOn') throw new Error('Inspected target navigated or closed')
      return {}
    })
    await expect(evaluateInPage(cdp, '({})', null)).rejects.toThrow('Inspected target navigated or closed')
  })

  test('rejects a malformed answer instead of guessing', async () => {
    const { cdp } = scripted(() => ({ nothing: true }))
    await expect(evaluateInPage(cdp, 'x', null)).rejects.toThrow('unexpected evaluate response')
  })
})
