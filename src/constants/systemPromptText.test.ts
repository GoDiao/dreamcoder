import { describe, expect, test } from 'bun:test'
import { getSimpleDoingTasksSection, getSimpleSystemSection, getSimpleToneAndStyleSection } from './prompts.js'

describe('system prompt text for DreamCoder', () => {
  test('help and feedback point to DreamCoder', () => {
    const text = getSimpleDoingTasksSection()

    expect(text).not.toContain('Claude Code')
    expect(text).toContain('/help')
    expect(text).toContain('https://github.com/GoDiao/dreamcoder/issues')
  })

  test('describes how replies are shown without a terminal font or clickable-link promises', () => {
    const text = `${getSimpleSystemSection()}\n${getSimpleToneAndStyleSection()}`

    expect(text).not.toContain('monospace')
    expect(text).not.toContain('CommonMark')
    expect(text).not.toContain('anthropics/claude-code')
    expect(text).not.toContain('clickable')
    expect(text).not.toContain('may not be shown directly')
    expect(text).toContain('GitHub-flavored Markdown')
  })
})
