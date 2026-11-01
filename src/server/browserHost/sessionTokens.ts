import { randomBytes } from 'node:crypto'

export class BrowserSessionTokens {
  private readonly tokenBySession = new Map<string, string>()
  private readonly sessionByToken = new Map<string, string>()

  issue(sessionId: string): string {
    const existing = this.tokenBySession.get(sessionId)
    if (existing) return existing
    const token = randomBytes(32).toString('hex')
    this.tokenBySession.set(sessionId, token)
    this.sessionByToken.set(token, sessionId)
    return token
  }

  resolve(token: string): string | null {
    return this.sessionByToken.get(token) ?? null
  }

  revoke(sessionId: string) {
    const token = this.tokenBySession.get(sessionId)
    if (!token) return
    this.tokenBySession.delete(sessionId)
    this.sessionByToken.delete(token)
  }
}

export const browserSessionTokens = new BrowserSessionTokens()
