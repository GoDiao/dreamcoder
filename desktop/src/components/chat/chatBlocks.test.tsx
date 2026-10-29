import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { PermissionDialog } from './PermissionDialog'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

describe('chat blocks', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({ activeTabId: 'active-tab', tabs: [{ sessionId: 'active-tab', title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({ sessions: {} })
  })

  it('keeps thinking collapsed by default', () => {
    const { container } = render(<ThinkingBlock content="this is a long internal reasoning trace" isActive />)

    expect(screen.getByText(/Thinking/)).toBeTruthy()
    expect(container.textContent).toContain('this is a long internal reasoning trace')
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
    expect(container.querySelector('[data-slot=trace-line][data-status=running]')).not.toBeNull()
  })

  it('does not animate inactive historical thinking blocks', () => {
    const { container } = render(<ThinkingBlock content="old reasoning" isActive={false} />)

    expect(container.querySelector('[data-slot=trace-line][data-status=running]')).toBeNull()
  })

  it('shows tool previews only after expanding the tool block', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Read"
        input={{ file_path: '/tmp/example.ts', limit: 20 }}
        result={{ content: 'const answer = 42\nconsole.log(answer)', isError: false }}
      />,
    )

    expect(container.textContent).toContain('Read')
    expect(container.textContent).not.toContain('const answer = 42')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('/tmp/example.ts')
    expect(container.textContent).not.toContain('const answer = 42')
  })

  it('shows the bash command and its output in one box once expanded', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls -la', description: 'List files' }}
        result={{ content: 'file-a\nfile-b\nfile-c', isError: false }}
      />,
    )

    expect(container.textContent).toContain('Bash')
    expect(container.textContent).not.toContain('file-a')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('# List files')
    expect(container.textContent).toContain('$ ls -la')
    expect(container.textContent).toContain('file-a')
    // The command is shown once, not again as raw input JSON.
    expect(container.textContent).not.toContain('"command"')
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2)
  })

  it('does not turn image paths in tool output into an image gallery', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls /tmp/shots' }}
        result={{ content: '/tmp/shots/a.png\n/tmp/shots/b.jpg', isError: false }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('/tmp/shots/a.png')
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps tool chrome out of text selection', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls', timeout: 5000 }}
        result={{ content: 'file-a', isError: false }}
      />,
    )

    const row = screen.getByRole('button', { expanded: false })
    expect(row.className).toContain('select-none')
    fireEvent.click(row)

    expect(screen.getByText('$').className).toContain('select-none')
    for (const button of screen.getAllByRole('button', { name: 'Copy' })) {
      expect(button.className).toContain('select-none')
    }
    const fullInput = screen.getByRole('button', { name: 'Show full input' })
    expect(fullInput.className).toContain('select-none')
    fireEvent.click(fullInput)
    expect(container.textContent).toContain('"timeout": 5000')
  })

  it('shows pending Write tool calls while input is still streaming', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Write"
        input={{ file_path: '/private/tmp/ai-code-novel.md' }}
        isPending
        partialInput={'{"file_path":"/private/tmp/ai-code-novel.md","content":"第一章'}
      />,
    )

    expect(container.textContent).toContain('Write')
    expect(container.textContent).toContain('ai-code-novel.md')
    expect(container.textContent).toContain('Generating content')
  })

  it('expands pending Write tool calls into a live writer preview instead of raw JSON', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Write"
        input={{ file_path: '/private/tmp/ai-code-novel.md' }}
        isPending
        partialInput={'{"file_path":"/private/tmp/ai-code-novel.md","content":"# 第一章\\n\\n正文正在生成'}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Writer')
    expect(container.textContent).toContain('# 第一章')
    expect(container.textContent).toContain('正文正在生成')
    expect(container.textContent).not.toContain('"content"')
  })

  it('windows long pending Write previews to the latest content', () => {
    const lines = Array.from({ length: 180 }, (_, index) => `line-${index + 1}`)
    const escapedContent = lines.join('\\n')
    const { container } = render(
      <ToolCallBlock
        toolName="Write"
        input={{ file_path: '/private/tmp/generated.ts' }}
        isPending
        partialInput={`{"file_path":"/private/tmp/generated.ts","content":"${escapedContent}`}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('latest')
    expect(container.textContent).toContain('line-180')
    expect(container.textContent).not.toContain('line-30')
  })

  it('shows a collapsed error summary for failed bash commands', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'git show 5016bc0 --no-stat', description: 'Show full diff of latest commit' }}
        result={{ content: 'fatal: unrecognized argument: --no-stat\nExit code 128', isError: true }}
      />,
    )

    expect(container.textContent).toContain('Bash')
    expect(container.textContent).toContain('fatal: unrecognized argument: --no-stat')
  })

  it('expands tool errors so full Computer Use gate messages are readable', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="mcp__computer-use__left_click"
        input={{ coordinate: [120, 220] }}
        result={{
          content: '"DreamCoder" is not in the allowed applications and is currently in front. Take a new screenshot — it may have appeared since your last one.',
          isError: true,
        }}
      />,
    )

    expect(container.textContent).toContain('mcp__computer-use__left_click')
    expect(container.textContent).not.toContain('Take a new screenshot')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Take a new screenshot')
    expect(container.textContent).toContain('allowed applications')
  })

  it('shows a diff preview for edit permission requests', async () => {
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: {
            requestId: 'perm-1',
            toolName: 'Edit',
            input: {
              file_path: '/tmp/example.ts',
              old_string: 'const count = 1',
              new_string: 'const count = 2',
            },
          },
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
        },
      },
    })

    let container!: HTMLElement
    await act(async () => {
      container = render(
        <PermissionDialog
          requestId="perm-1"
          toolName="Edit"
          input={{
            file_path: '/tmp/example.ts',
            old_string: 'const count = 1',
            new_string: 'const count = 2',
          }}
        />,
      ).container
      await Promise.resolve()
    })

    expect(container.textContent).toContain('/tmp/example.ts')
    expect(container.textContent).toContain('Allow')
    expect(container.querySelector('[class*="rounded-lg"]')).toBeTruthy()
  })
})
