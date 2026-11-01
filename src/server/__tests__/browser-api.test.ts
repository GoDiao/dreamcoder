import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { handleBrowserApi } from '../api/browser.js'
import { getBrowserRuntime } from '../browserHost/runtime.js'

function post(action: string, body: unknown, method = 'POST') {
  const url = new URL(`http://x/api/browser/emulation/${action}`)
  return handleBrowserApi(new Request(url, { method, body: method === 'POST' ? JSON.stringify(body) : undefined }), url, ['api', 'browser', 'emulation', action])
}

describe('browser API: emulation suspend and resume', () => {
  afterEach(() => {
    const { service } = getBrowserRuntime()
    spyOn(service, 'suspendEmulation').mockRestore()
    spyOn(service, 'resumeEmulation').mockRestore()
  })

  it('suspends and resumes the emulation of the tab and reports whether anything changed', async () => {
    const { service } = getBrowserRuntime()
    const suspend = spyOn(service, 'suspendEmulation').mockResolvedValue(true)
    const resume = spyOn(service, 'resumeEmulation').mockResolvedValue(false)

    const suspended = await post('suspend', { sessionId: 's1', tabId: 't1' })
    const resumed = await post('resume', { sessionId: 's1', tabId: 't1' })

    expect(await suspended.json()).toEqual({ changed: true })
    expect(await resumed.json()).toEqual({ changed: false })
    expect(suspend).toHaveBeenCalledWith('s1', 't1')
    expect(resume).toHaveBeenCalledWith('s1', 't1')
  })

  it('rejects missing ids, other actions and other methods', async () => {
    expect((await post('suspend', { tabId: 't1' })).status).toBe(400)
    expect((await post('suspend', { sessionId: 's1' })).status).toBe(400)
    expect((await post('suspend', 'nope')).status).toBe(400)
    expect((await post('freeze', { sessionId: 's1', tabId: 't1' })).status).toBe(404)
    expect((await post('suspend', {}, 'GET')).status).toBe(405)
  })
})
