import { createSessionState, reduceSessionState } from './reducer.js'
import type { RestoredSessionFields, SessionState, SessionStateEvent, SessionStatePatch } from './types.js'

export type SessionStateChange = {
  sessionId: string
  event: SessionStateEvent
  patch: SessionStatePatch
  previous: SessionState
  state: SessionState
}

export type SessionStateListener = (change: SessionStateChange) => void

export type SessionStateRestorer = (sessionId: string) => Promise<RestoredSessionFields | null>

type RestorableField = keyof RestoredSessionFields

export class SessionStateStore {
  private states = new Map<string, SessionState>()
  private restores = new Map<string, Promise<SessionState>>()
  private restored = new Set<string>()
  private touched = new Map<string, Set<RestorableField>>()
  private listeners = new Set<SessionStateListener>()
  private restorer: SessionStateRestorer | null = null

  setRestorer(restorer: SessionStateRestorer | null): void {
    this.restorer = restorer
  }

  peek(sessionId: string): SessionState | undefined {
    return this.states.get(sessionId)
  }

  get(sessionId: string): SessionState {
    let state = this.states.get(sessionId)
    if (!state) {
      state = createSessionState(sessionId)
      this.states.set(sessionId, state)
    }
    return state
  }

  isRestored(sessionId: string): boolean {
    return this.restored.has(sessionId)
  }

  ensure(sessionId: string): Promise<SessionState> {
    if (this.restored.has(sessionId)) return Promise.resolve(this.get(sessionId))
    const pending = this.restores.get(sessionId)
    if (pending) return pending
    this.get(sessionId)
    const restorer = this.restorer
    const restore = (restorer ? restorer(sessionId).catch(() => null) : Promise.resolve(null))
      .then((fields) => {
        if (this.restores.get(sessionId) !== restore) return this.states.get(sessionId) ?? createSessionState(sessionId)
        this.restores.delete(sessionId)
        this.restored.add(sessionId)
        const touched = this.touched.get(sessionId)
        this.touched.delete(sessionId)
        if (fields) {
          this.apply(sessionId, { type: 'restored', fields: this.keepTouched(sessionId, fields, touched) })
        }
        return this.get(sessionId)
      })
    this.restores.set(sessionId, restore)
    return restore
  }

  apply(sessionId: string, event: SessionStateEvent): SessionStatePatch {
    const previous = this.get(sessionId)
    const { state, patch } = reduceSessionState(previous, event)
    if (event.type !== 'restored') this.noteTouched(sessionId, event, previous, state)
    if (Object.keys(patch).length === 0) return patch
    this.states.set(sessionId, state)
    for (const listener of this.listeners) {
      listener({ sessionId, event, patch, previous, state })
    }
    return patch
  }

  applyIfPresent(sessionId: string, event: SessionStateEvent): SessionStatePatch {
    if (!this.states.has(sessionId)) return {}
    return this.apply(sessionId, event)
  }

  async read(sessionId: string): Promise<SessionState> {
    if (this.states.has(sessionId)) return this.ensure(sessionId)
    const fields = this.restorer ? await this.restorer(sessionId).catch(() => null) : null
    if (this.states.has(sessionId)) return this.ensure(sessionId)
    const state = createSessionState(sessionId)
    return fields ? reduceSessionState(state, { type: 'restored', fields }).state : state
  }

  subscribe(listener: SessionStateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(sessionId: string): void {
    this.states.delete(sessionId)
    this.restores.delete(sessionId)
    this.restored.delete(sessionId)
    this.touched.delete(sessionId)
  }

  clear(): void {
    this.states.clear()
    this.restores.clear()
    this.restored.clear()
    this.touched.clear()
  }

  private noteTouched(sessionId: string, event: SessionStateEvent, previous: SessionState, next: SessionState): void {
    if (this.restored.has(sessionId)) return
    const fields: RestorableField[] = []
    if (event.type === 'permission_desired_changed' || previous.permission.desired !== next.permission.desired) {
      fields.push('permissionMode')
    }
    if (event.type === 'runtime_desired_changed' || previous.runtime.desired !== next.runtime.desired) fields.push('runtime')
    if (event.type === 'title_changed' || previous.title !== next.title) fields.push('title')
    if (previous.workspace.workDir !== next.workspace.workDir) fields.push('workspace')
    if (fields.length === 0) return
    let touched = this.touched.get(sessionId)
    if (!touched) {
      touched = new Set()
      this.touched.set(sessionId, touched)
    }
    for (const field of fields) touched.add(field)
  }

  private keepTouched(
    sessionId: string,
    fields: RestoredSessionFields,
    touched: Set<RestorableField> | undefined,
  ): RestoredSessionFields {
    if (!touched || touched.size === 0) return fields
    const current = this.get(sessionId)
    return {
      permissionMode: touched.has('permissionMode') ? current.permission.desired : fields.permissionMode,
      runtime: touched.has('runtime') ? current.runtime.desired : fields.runtime,
      title: touched.has('title') ? current.title : fields.title,
      workspace: touched.has('workspace') && current.workspace.workDir
        ? { ...fields.workspace, workDir: current.workspace.workDir, workDirExists: current.workspace.workDirExists }
        : fields.workspace,
      uiPages: fields.uiPages,
    }
  }
}

export const sessionStateStore = new SessionStateStore()
