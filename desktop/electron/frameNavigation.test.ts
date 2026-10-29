import { describe, expect, it } from 'vitest'
import { isAllowedFrameNavigation } from './frameNavigation'

describe('frame navigation', () => {
  it('allows the sidecar page host on loopback', () => {
    expect(isAllowedFrameNavigation('http://127.0.0.1:3456/ui-pages/s1/abc/1')).toBe(true)
    expect(isAllowedFrameNavigation('http://localhost:51234/ui-pages/s1/abc/2')).toBe(true)
  })

  it('refuses anything a page could use to send data away or reach the app', () => {
    expect(isAllowedFrameNavigation('https://example.com/ui-pages/s1/abc/1')).toBe(false)
    expect(isAllowedFrameNavigation('http://example.com/ui-pages/s1/abc/1')).toBe(false)
    expect(isAllowedFrameNavigation('http://127.0.0.1.example.com/ui-pages/s1/abc/1')).toBe(false)
    expect(isAllowedFrameNavigation('http://127.0.0.1:3456/api/sessions')).toBe(false)
    expect(isAllowedFrameNavigation('http://127.0.0.1:3456/')).toBe(false)
    expect(isAllowedFrameNavigation('dreamcoder://localhost/index.html')).toBe(false)
    expect(isAllowedFrameNavigation('file:///etc/passwd')).toBe(false)
    expect(isAllowedFrameNavigation('about:srcdoc')).toBe(true)
    expect(isAllowedFrameNavigation('about:blank')).toBe(false)
    expect(isAllowedFrameNavigation('data:text/html,<p>x</p>')).toBe(false)
    expect(isAllowedFrameNavigation('javascript:alert(1)')).toBe(false)
    expect(isAllowedFrameNavigation('not a url')).toBe(false)
  })
})
