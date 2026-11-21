import { afterEach, describe, expect, test } from 'bun:test'
import { DESKTOP_HOST_ENV } from '../utils/desktopHost.js'
import { computeSimpleEnvInfo } from './prompts.js'

const originalHost = process.env[DESKTOP_HOST_ENV]

afterEach(() => {
  if (originalHost === undefined) delete process.env[DESKTOP_HOST_ENV]
  else process.env[DESKTOP_HOST_ENV] = originalHost
})

const HOST_LINE =
  'You are running in the DreamCoder app. The user reads your replies there, rendered as GitHub-flavored Markdown, and sees each tool call as its own card.'

describe('environment section', () => {
  test.each(['glm-5.1', 'claude-sonnet-4-6'])('names the model in use without Claude product text for %s', async model => {
    const env = await computeSimpleEnvInfo(model)

    expect(env).toContain(model)
    expect(env).not.toContain('Claude model family')
    expect(env).not.toContain('Claude Code is available')
    expect(env).not.toContain('/fast')
  })

  test('describes the DreamCoder app when the app started the CLI', async () => {
    process.env[DESKTOP_HOST_ENV] = '1'

    expect(await computeSimpleEnvInfo('glm-5.1')).toContain(HOST_LINE)
  })

  test('says nothing about the app when the CLI runs on its own', async () => {
    delete process.env[DESKTOP_HOST_ENV]

    expect(await computeSimpleEnvInfo('glm-5.1')).not.toContain('DreamCoder app')
  })
})
