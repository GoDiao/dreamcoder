import { describe, expect, test } from 'bun:test'
import { getExitWorktreeToolPrompt } from '../ExitWorktreeTool/prompt.js'
import { getEnterWorktreeToolPrompt } from './prompt.js'

describe('worktree tool text in the desktop app', () => {
  test('describes no hooks, tmux sessions or exit prompts', () => {
    const text = `${getEnterWorktreeToolPrompt()}\n${getExitWorktreeToolPrompt()}`

    expect(text).not.toContain('WorktreeCreate')
    expect(text).not.toContain('tmux')
    expect(text).not.toContain('prompted to keep or remove')
  })

  test('says the desktop panels keep showing the original directory', () => {
    expect(getEnterWorktreeToolPrompt()).toContain('panels')
  })

})
