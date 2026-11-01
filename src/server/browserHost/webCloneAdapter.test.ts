import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { launchChromium, loadPlaywright } from '../../../desktop/web-clone/scripts/lib/playwright-loader.mjs'
import type { BackgroundBrowserEvent, BrowserHostChannel } from './hostChannel.js'
import type { BackgroundBrowserCommand } from './protocol.js'
import { BrowserSessionTokens } from './sessionTokens.js'
import { handleWebCloneHttp, WebCloneBrowsers, type WebCloneSocketData } from './webClone.js'

class FakeChannel {
  commands: BackgroundBrowserCommand[] = []
  private events = new Set<(event: BackgroundBrowserEvent) => void>()
  isConnected() {
    return true
  }
  async requestBackground(command: BackgroundBrowserCommand) {
    this.commands.push(command)
    if (command.kind !== 'cdp') return {}
    if (command.method === 'Runtime.evaluate') return { result: { result: { type: 'string', value: 'hello' } } }
    return { result: {} }
  }
  onBackgroundEvent(listener: (event: BackgroundBrowserEvent) => void) {
    this.events.add(listener)
    return () => this.events.delete(listener)
  }
  onDisconnect() {
    return () => undefined
  }
}

let server: Server<WebCloneSocketData>
let channel: FakeChannel
let tokens: BrowserSessionTokens
let browsers: WebCloneBrowsers
const environment = { url: process.env.DREAMCODER_WEB_CLONE_URL, token: process.env.DREAMCODER_WEB_CLONE_TOKEN }

beforeEach(() => {
  channel = new FakeChannel()
  tokens = new BrowserSessionTokens()
  browsers = new WebCloneBrowsers({ channel: channel as unknown as BrowserHostChannel, tokens, grants: { async ensureOperation() {} } })
  server = Bun.serve<WebCloneSocketData>({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request, bunServer) => handleWebCloneHttp(request, new URL(request.url), { browsers, upgrade: (data) => bunServer.upgrade(request, { data }) }) as Promise<Response | undefined>,
    websocket: {
      open: (ws) => browsers.open(ws),
      message: (ws, message) => void browsers.message(ws, message),
      close: (ws) => browsers.close(ws),
    },
  })
})

afterEach(async () => {
  await server.stop(true)
  if (environment.url === undefined) delete process.env.DREAMCODER_WEB_CLONE_URL
  else process.env.DREAMCODER_WEB_CLONE_URL = environment.url
  if (environment.token === undefined) delete process.env.DREAMCODER_WEB_CLONE_TOKEN
  else process.env.DREAMCODER_WEB_CLONE_TOKEN = environment.token
})

function useEnvironment(token: string) {
  process.env.DREAMCODER_WEB_CLONE_URL = `http://127.0.0.1:${server.port}/web-clone-browser`
  process.env.DREAMCODER_WEB_CLONE_TOKEN = token
}

describe('the bundled script adapter against the sidecar interface', () => {
  test('opens a session, makes a page, runs commands over its socket and closes everything', async () => {
    useEnvironment(tokens.issue('cli-1'))
    const { chromium } = loadPlaywright()
    const browser = await launchChromium(chromium)
    const page = await browser.newPage()
    const value = await page.evaluate('1 + 1')
    expect(value).toBe('hello')
    const kinds = channel.commands.map(command => command.kind)
    expect(kinds[0]).toBe('createTarget')
    expect(channel.commands.filter(command => command.kind === 'cdp').map(command => (command as { method: string }).method)).toEqual(
      expect.arrayContaining(['Page.enable', 'Runtime.enable', 'Network.enable', 'Emulation.setDeviceMetricsOverride', 'Runtime.evaluate']),
    )
    await page.close()
    await browser.close()
    expect(channel.commands.map(command => command.kind)).toEqual(expect.arrayContaining(['closeTarget', 'destroySession']))
  })

  test('fails with a message about the token when the app does not know it', async () => {
    useEnvironment('wrong-token')
    const { chromium } = loadPlaywright()
    await expect(launchChromium(chromium)).rejects.toThrow('HTTP 401')
  })

  test('says that cloning needs the desktop app when the environment is missing', async () => {
    delete process.env.DREAMCODER_WEB_CLONE_URL
    delete process.env.DREAMCODER_WEB_CLONE_TOKEN
    const { chromium } = loadPlaywright()
    await expect(launchChromium(chromium)).rejects.toThrow('needs the DreamCoder desktop app')
  })
})
