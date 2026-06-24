import { describe, expect, it } from 'bun:test'
import {
  buildDingTalkPermissionCardParams,
  parseDingTalkPermissionCardAction,
} from '../permission-card.js'

describe('DingTalk permission card helpers', () => {
  it('builds template params with three permission actions', () => {
    const params = buildDingTalkPermissionCardParams('Bash', { command: 'npm test' }, 'req-1')

    expect(params.requestId).toBe('req-1')
    expect(params.toolName).toBe('Bash')
    expect(String(params.inputPreview)).toContain('npm test')
    expect(JSON.parse(String(params.allowValue))).toEqual({ action: 'permit', requestId: 'req-1', allowed: true })
    expect(JSON.parse(String(params.alwaysValue))).toEqual({ action: 'permit', requestId: 'req-1', allowed: true, rule: 'always' })
    expect(JSON.parse(String(params.denyValue))).toEqual({ action: 'permit', requestId: 'req-1', allowed: false })
  })

  it('parses nested card private params', () => {
    const action = parseDingTalkPermissionCardAction({
      outTrackId: 'permission_req-1',
      content: JSON.stringify({
        cardPrivateData: {
          params: {
            action: 'permit',
            requestId: 'req-1',
            allowed: true,
            rule: 'always',
          },
        },
      }),
    })

    expect(action).toEqual({ requestId: 'req-1', allowed: true, rule: 'always' })
  })

  it('parses compact callback values', () => {
    expect(parseDingTalkPermissionCardAction({ actionValue: 'permit:req-2:no' })).toEqual({
      requestId: 'req-2',
      allowed: false,
    })
  })

  it('ignores callbacks without permission action data', () => {
    expect(parseDingTalkPermissionCardAction({ action: 'open_url', url: 'https://example.com' })).toBeNull()
  })
})
