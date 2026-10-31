import { beforeEach, describe, expect, it } from 'vitest'
import {
  formatWorkspaceReferencePrompt,
  useWorkspaceChatContextStore,
} from './workspaceChatContextStore'

const initialState = useWorkspaceChatContextStore.getInitialState()

describe('workspaceChatContextStore', () => {
  beforeEach(() => {
    useWorkspaceChatContextStore.setState(initialState, true)
  })

  it('deduplicates file references per session', () => {
    const store = useWorkspaceChatContextStore.getState()

    store.addReference('session-1', {
      kind: 'file',
      path: 'src/App.tsx',
      absolutePath: '/repo/src/App.tsx',
      name: 'App.tsx',
    })
    store.addReference('session-1', {
      kind: 'file',
      path: 'src/App.tsx',
      absolutePath: '/repo/src/App.tsx',
      name: 'App.tsx',
    })

    expect(useWorkspaceChatContextStore.getState().referencesBySession['session-1']).toHaveLength(1)
  })

  it('keeps two elements of one page apart and replaces a re-picked one', () => {
    const store = useWorkspaceChatContextStore.getState()
    const pick = (ref: string, selector: string, name: string) => ({
      kind: 'browser' as const,
      path: 'https://example.com/a',
      name,
      browser: {
        url: 'https://example.com/a',
        title: 'Example',
        text: name,
        truncated: false,
        element: { ref, tag: 'button', label: 'button', role: 'button', name, selector, sensitive: false, stale: false },
      },
    })

    store.addReference('session-1', pick('e1', 'button.a', 'Buy'))
    store.addReference('session-1', pick('e2', 'button.b', 'Cancel'))
    store.addReference('session-1', pick('e1', 'button.a', 'Buy again'))

    const references = useWorkspaceChatContextStore.getState().referencesBySession['session-1'] ?? []
    expect(references.map((reference) => reference.browser?.text)).toEqual(['Cancel', 'Buy again'])
    expect(new Set(references.map((reference) => reference.id)).size).toBe(2)
  })

  it('keeps the same element of two documents apart', () => {
    const store = useWorkspaceChatContextStore.getState()
    const pick = (generation: number, name: string) => ({
      kind: 'browser' as const,
      path: 'https://example.com/a',
      name,
      browser: {
        url: 'https://example.com/a',
        title: 'Example',
        text: name,
        truncated: false,
        element: {
          ref: '1',
          generation,
          tag: 'button',
          label: 'button',
          role: 'button',
          name,
          selector: 'button',
          sensitive: false,
          stale: false,
        },
      },
    })
    store.addReference('session-1', pick(0, 'before reload'))
    store.addReference('session-1', pick(1, 'after reload'))
    expect((useWorkspaceChatContextStore.getState().referencesBySession['session-1'] ?? []).map((reference) => reference.browser?.text)).toEqual([
      'before reload',
      'after reload',
    ])
  })

  describe('pending picks', () => {
    const pending = (pickId: string) => ({
      id: `browser-pick:${pickId}`,
      kind: 'browser' as const,
      path: '',
      name: '',
      browser: { url: '', title: '', tabId: 'tab-1', text: '', truncated: false, pendingPickId: pickId },
    })
    const filled = (ref: string) => ({
      kind: 'browser' as const,
      path: 'https://example.com/a',
      name: 'Buy',
      browser: {
        url: 'https://example.com/a',
        title: 'Example',
        tabId: 'tab-1',
        text: 'Buy',
        truncated: false,
        element: { ref, generation: 0, tag: 'button', label: 'button', role: 'button', name: 'Buy', selector: 'button', sensitive: false, stale: false },
      },
    })
    const list = () => useWorkspaceChatContextStore.getState().referencesBySession['session-1'] ?? []

    it('does not merge two pending picks', () => {
      const store = useWorkspaceChatContextStore.getState()
      store.addReference('session-1', pending('a'))
      store.addReference('session-1', pending('b'))
      expect(list().map((reference) => reference.id)).toEqual(['browser-pick:a', 'browser-pick:b'])
    })

    it('replaces a pending pick where it stands', () => {
      const store = useWorkspaceChatContextStore.getState()
      store.addReference('session-1', pending('a'))
      store.addReference('session-1', pending('b'))
      store.replaceReference('session-1', 'browser-pick:a', filled('7'))
      expect(list().map((reference) => reference.browser?.element?.ref ?? reference.browser?.pendingPickId)).toEqual(['7', 'b'])
    })

    it('drops an older reference of the same element when the pick finishes', () => {
      const store = useWorkspaceChatContextStore.getState()
      store.addReference('session-1', filled('7'))
      store.addReference('session-1', pending('a'))
      store.replaceReference('session-1', 'browser-pick:a', filled('7'))
      expect(list()).toHaveLength(1)
      expect(list()[0]?.browser?.pendingPickId).toBeUndefined()
    })

    it('removes a pending pick that failed, and ignores one the user already removed', () => {
      const store = useWorkspaceChatContextStore.getState()
      store.addReference('session-1', pending('a'))
      store.replaceReference('session-1', 'browser-pick:a', null)
      expect(list()).toEqual([])
      store.replaceReference('session-1', 'browser-pick:a', filled('7'))
      expect(list()).toEqual([])
    })
  })

  describe('stale elements', () => {
    const element = (tabId: string, ref: string, stale = false) => ({
      kind: 'browser' as const,
      path: 'https://example.com/a',
      name: ref,
      browser: {
        url: 'https://example.com/a',
        title: 'Example',
        tabId,
        text: ref,
        truncated: false,
        element: { ref, generation: 0, tag: 'b', label: 'b', role: '', name: '', selector: `b${ref}`, sensitive: false, stale },
      },
    })
    const staleFlags = () =>
      (useWorkspaceChatContextStore.getState().referencesBySession['session-1'] ?? []).map((reference) => reference.browser?.element?.stale)

    it('marks every element of a tab, and only that tab', () => {
      const store = useWorkspaceChatContextStore.getState()
      store.addReference('session-1', element('tab-1', '1'))
      store.addReference('session-1', element('tab-2', '2'))
      store.markBrowserElementsStale('session-1', 'tab-1')
      expect(staleFlags()).toEqual([true, false])
    })

    it('marks only the listed refs when given', () => {
      const store = useWorkspaceChatContextStore.getState()
      store.addReference('session-1', element('tab-1', '1'))
      store.addReference('session-1', element('tab-1', '2'))
      store.markBrowserElementsStale('session-1', 'tab-1', ['2'])
      expect(staleFlags()).toEqual([false, true])
    })

    it('leaves the state object alone when nothing changes', () => {
      const store = useWorkspaceChatContextStore.getState()
      store.addReference('session-1', element('tab-1', '1', true))
      const before = useWorkspaceChatContextStore.getState().referencesBySession
      store.markBrowserElementsStale('session-1', 'tab-1')
      store.markBrowserElementsStale('session-1', 'tab-9')
      store.markBrowserElementsStale('other-session', 'tab-1')
      expect(useWorkspaceChatContextStore.getState().referencesBySession).toBe(before)
    })
  })

  it('puts the browser block before the workspace context in the request prompt', () => {
    const prompt = formatWorkspaceReferencePrompt([
      {
        id: 'ref-1',
        kind: 'code-comment',
        path: 'src/App.tsx',
        name: 'App.tsx',
        lineStart: 4,
        note: 'tighten this',
      },
      {
        id: 'ref-2',
        kind: 'browser',
        path: 'https://example.com/a',
        name: 'Example',
        browser: { url: 'https://example.com/a', title: 'Example', text: 'quoted', truncated: false },
      },
    ])

    expect(prompt.startsWith('Referenced browser content')).toBe(true)
    expect(prompt.indexOf('Referenced workspace context:')).toBeGreaterThan(prompt.indexOf('quoted'))
    expect(prompt).not.toContain('@"https://example.com/a"')
  })

  it('formats line comments into the request prompt', () => {
    const prompt = formatWorkspaceReferencePrompt([
      {
        id: 'ref-1',
        kind: 'code-comment',
        path: 'src/App.tsx',
        absolutePath: '/repo/src/App.tsx',
        name: 'App.tsx',
        lineStart: 12,
        lineEnd: 12,
        note: 'Use a clearer name',
        quote: 'const value = 1',
      },
    ])

    expect(prompt).toContain('Referenced workspace context:')
    expect(prompt).toContain('@"src/App.tsx:L12":')
    expect(prompt).toContain('Comment: Use a clearer name')
    expect(prompt).toContain('```tsx\nconst value = 1\n```')
    expect(prompt).not.toContain('Use the Read tool')
    expect(prompt).not.toContain('Path: /repo/src/App.tsx')
  })

  it('formats selected code without requiring a comment', () => {
    const prompt = formatWorkspaceReferencePrompt([
      {
        id: 'ref-1',
        kind: 'code-selection',
        path: 'src/App.tsx',
        absolutePath: '/repo/src/App.tsx',
        name: 'App.tsx',
        lineStart: 10,
        lineEnd: 12,
        quote: 'const value = 1\nreturn value',
      },
    ])

    expect(prompt).toContain('Referenced workspace context:')
    expect(prompt).toContain('@"src/App.tsx:L10-L12":')
    expect(prompt).toContain('```tsx\nconst value = 1\nreturn value\n```')
    expect(prompt).not.toContain('Comment:')
  })

  it('formats selected chat messages as chat context instead of file context', () => {
    const prompt = formatWorkspaceReferencePrompt([
      {
        id: 'chat-ref-1',
        kind: 'chat-selection',
        path: 'chat://assistant/assistant-1',
        name: 'Assistant message',
        messageId: 'assistant-1',
        sourceRole: 'assistant',
        quote: 'Use the workspace panel selection menu.',
      },
    ])

    expect(prompt).toContain('Referenced chat context:')
    expect(prompt).toContain('Assistant message:')
    expect(prompt).toContain('```\nUse the workspace panel selection menu.\n```')
    expect(prompt).not.toContain('@"chat://assistant/assistant-1"')
    expect(prompt).not.toContain('Referenced workspace context:')
  })

  it('does not add prompt text for plain file attachments', () => {
    const prompt = formatWorkspaceReferencePrompt([
      {
        id: 'ref-1',
        kind: 'file',
        path: 'src/App.tsx',
        absolutePath: '/repo/src/App.tsx',
        name: 'App.tsx',
      },
    ])

    expect(prompt).toBe('')
  })
})
