import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { AdapterHttpClient } from '../http-client.js'

describe('AdapterHttpClient', () => {
  let client: AdapterHttpClient
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    client = new AdapterHttpClient('ws://127.0.0.1:3456')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('derives HTTP URL from WS URL', () => {
    expect(client.httpBaseUrl).toBe('http://127.0.0.1:3456')

    const secure = new AdapterHttpClient('wss://example.com:443')
    expect(secure.httpBaseUrl).toBe('https://example.com:443')
  })

  it('createSession calls POST /api/sessions', async () => {
    const mockSessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ sessionId: mockSessionId }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    const sessionId = await client.createSession('/path/to/project')
    expect(sessionId).toBe(mockSessionId)

    const call = (globalThis.fetch as any).mock.calls[0]
    expect(call[0]).toBe('http://127.0.0.1:3456/api/sessions')
    const body = JSON.parse(call[1].body)
    expect(body.workDir).toBe('/path/to/project')
  })

  it('listRecentProjects calls GET /api/sessions/recent-projects', async () => {
    const mockProjects = [
      { projectName: 'my-app', realPath: '/home/user/my-app', sessionCount: 3 },
    ]
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ projects: mockProjects }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    const projects = await client.listRecentProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].projectName).toBe('my-app')
  })

  it('matchProject accepts an absolute local project path inside an allowed root without recent history', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-root-'))
    const projectDir = fs.mkdtempSync(path.join(rootDir, 'project-'))
    try {
      client = new AdapterHttpClient('ws://127.0.0.1:3456', { allowedProjectRoots: [rootDir] })
      globalThis.fetch = mock(() => {
        throw new Error('recent projects should not be queried for absolute paths')
      }) as any

      const result = await client.matchProject(projectDir)

      expect(result.project?.realPath).toBe(fs.realpathSync(projectDir))
      expect(result.project?.projectName).toBe(path.basename(projectDir))
      expect((globalThis.fetch as any).mock.calls).toHaveLength(0)
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('matchProject rejects absolute local project paths outside allowed roots', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-root-'))
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-project-'))
    try {
      client = new AdapterHttpClient('ws://127.0.0.1:3456', { allowedProjectRoots: [rootDir] })
      globalThis.fetch = mock(() => {
        throw new Error('recent projects should not be queried for rejected absolute paths')
      }) as any

      const result = await client.matchProject(projectDir)

      expect(result.project).toBeUndefined()
      expect(result.ambiguous).toBeUndefined()
      expect((globalThis.fetch as any).mock.calls).toHaveLength(0)
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true })
      fs.rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('createSession throws on server error', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'workDir required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    expect(client.createSession('')).rejects.toThrow()
  })

  it('sessionExists returns false for deleted sessions', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    await expect(client.sessionExists('deleted-session')).resolves.toBe(false)
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe(
      'http://127.0.0.1:3456/api/sessions/deleted-session',
    )
  })

  it('getGitInfo calls GET /api/sessions/:id/git-info', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        branch: 'main',
        repoName: 'claude-code-haha',
        workDir: '/repo/claude-code-haha',
        changedFiles: 2,
      }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    const gitInfo = await client.getGitInfo('session-123')
    expect(gitInfo.repoName).toBe('claude-code-haha')
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe(
      'http://127.0.0.1:3456/api/sessions/session-123/git-info',
    )
  })

  it('getTasksForSession calls GET /api/tasks/lists/:id', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        tasks: [
          { id: '1', subject: 'Fix bug', status: 'in_progress' },
          { id: '2', subject: 'Write docs', status: 'pending' },
        ],
      }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as any

    const tasks = await client.getTasksForSession('session-123')
    expect(tasks).toHaveLength(2)
    expect(tasks[0]?.status).toBe('in_progress')
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe(
      'http://127.0.0.1:3456/api/tasks/lists/session-123',
    )
  })
})
