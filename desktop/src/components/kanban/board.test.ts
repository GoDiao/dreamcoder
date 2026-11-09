import { describe, expect, it } from 'vitest'
import type { KanbanServiceErrorCode } from '@protocol'
import { ApiError } from '../../api/client'
import { en } from '../../i18n/locales/en'
import { zh } from '../../i18n/locales/zh'
import type { TranslationKey } from '../../i18n'
import { actorName, kanbanErrorMessage, linkTarget, moveIntent } from './board'
import { fixtureCard, fixtureView } from './kanbanFixture'

const ERROR_CODES: Record<KanbanServiceErrorCode, true> = {
  FORBIDDEN: true,
  NOT_FOUND: true,
  INVALID_REQUEST: true,
  INVALID_TRANSITION: true,
  NOT_READY: true,
  WOULD_CYCLE: true,
  REVIEWER_IS_OWNER: true,
  NO_OWNER: true,
  CONFLICT: true,
  START_FAILED: true,
}

describe('kanbanErrorMessage', () => {
  it.each([['en', en], ['zh', zh]] as const)('has %s text for every error code', (_, locale) => {
    const t = (key: TranslationKey, params?: Record<string, string | number>) =>
      Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), locale[key])
    for (const code of Object.keys(ERROR_CODES)) {
      const message = kanbanErrorMessage(t, new ApiError(409, { error: code, message: 'server text' }))
      expect(message).toBe(locale[`kanban.error.${code}` as TranslationKey])
      expect(message).not.toContain('server text')
    }
    expect(kanbanErrorMessage(t, new Error('boom'))).toContain('boom')
  })
})

describe('moveIntent', () => {
  it('maps each allowed drag to the command a person may send', () => {
    expect(moveIntent(fixtureCard(1, { status: 'backlog' }), 'todo')).toEqual({ kind: 'command', command: { type: 'move_card', card: 1, status: 'todo' } })
    expect(moveIntent(fixtureCard(1, { status: 'todo' }), 'in_progress')).toEqual({ kind: 'command', command: { type: 'start', card: 1 } })
    expect(moveIntent(fixtureCard(1, { status: 'review' }), 'done')).toEqual({ kind: 'report', type: 'accept' })
    expect(moveIntent(fixtureCard(1, { status: 'done' }), 'todo')).toEqual({ kind: 'reason', type: 'reopen', required: false })
    expect(moveIntent(fixtureCard(1, { status: 'blocked', blockedFrom: 'in_progress' }), 'in_progress')).toEqual({ kind: 'command', command: { type: 'unblock', card: 1 } })
  })

  it('asks for a reason or a summary before blocking, sending back, cancelling or submitting', () => {
    expect(moveIntent(fixtureCard(1, { status: 'in_progress' }), 'blocked')).toEqual({ kind: 'reason', type: 'block', required: true })
    expect(moveIntent(fixtureCard(1, { status: 'review' }), 'in_progress')).toEqual({ kind: 'reason', type: 'request_changes', required: true })
    expect(moveIntent(fixtureCard(1, { status: 'todo' }), 'cancelled')).toEqual({ kind: 'reason', type: 'cancel', required: false })
    expect(moveIntent(fixtureCard(1, { status: 'in_progress' }), 'review')).toEqual({ kind: 'report', type: 'submit' })
  })

  it('refuses moves no command makes', () => {
    expect(moveIntent(fixtureCard(1, { status: 'backlog' }), 'done')).toBeNull()
    expect(moveIntent(fixtureCard(1, { status: 'todo' }), 'review')).toBeNull()
    expect(moveIntent(fixtureCard(1, { status: 'done' }), 'cancelled')).toBeNull()
  })
})

describe('actorName', () => {
  it('names the person and a session by its title', () => {
    const t = (key: TranslationKey) => en[key]
    const view = fixtureView([], { sessions: { 'lead-a': { title: 'Auth lead', exists: true, running: false } } })
    expect(actorName(t, view, { kind: 'human' })).toBe('You')
    expect(actorName(t, view, { kind: 'session', sessionId: 'lead-a' })).toBe('Auth lead')
    expect(actorName(t, view, { kind: 'session', sessionId: 'unknown' })).toBe(en['kanban.actor.session'])
  })
})

describe('linkTarget', () => {
  const author = { kind: 'session', sessionId: 'reviewer' } as const

  it('opens web addresses in the browser and absolute files through the session that wrote them', () => {
    expect(linkTarget('https://example.test/pr/1', author)).toEqual({ kind: 'url', url: 'https://example.test/pr/1' })
    expect(linkTarget('/repo/docs/review.md', author)).toEqual({ kind: 'file', path: '/repo/docs/review.md', sessionId: 'reviewer' })
  })

  it('leaves branch names, relative paths and files from a person as plain text', () => {
    expect(linkTarget('feat/oauth', author)).toBeNull()
    expect(linkTarget('docs/review.md', author)).toBeNull()
    expect(linkTarget('/repo/docs/review.md', { kind: 'human' })).toBeNull()
  })
})

