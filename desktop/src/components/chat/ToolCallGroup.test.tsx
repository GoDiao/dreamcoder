import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ToolCallGroup } from './ToolCallGroup'
import { useSettingsStore } from '../../stores/settingsStore'
import type { UIMessage } from '../../types/chat'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

function readCall(id: string): ToolCall {
  return {
    id: `msg-${id}`,
    type: 'tool_use',
    toolName: 'Read',
    toolUseId: id,
    input: { file_path: `/repo/${id}.ts` },
    timestamp: 1,
  }
}

function resultFor(id: string, isError = false): ToolResult {
  return {
    id: `result-${id}`,
    type: 'tool_result',
    toolUseId: id,
    content: isError ? 'boom' : 'ok',
    isError,
    timestamp: 2,
  } as ToolResult
}

function renderGroup(results: ToolResult[], isStreaming = false) {
  const toolCalls = ['a', 'b', 'c'].map(readCall)
  const resultMap = new Map(results.map((result) => [result.toolUseId, result]))
  return render(
    <ToolCallGroup
      toolCalls={toolCalls}
      resultMap={resultMap}
      childToolCallsByParent={new Map()}
      agentTaskNotifications={{}}
      isStreaming={isStreaming}
    />,
  )
}

describe('ToolCallGroup', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('keeps a finished group collapsed until it is clicked', () => {
    renderGroup(['a', 'b', 'c'].map((id) => resultFor(id)))

    const header = screen.getByRole('button', { name: /Read 3 files/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps a running group collapsed after it finishes', () => {
    const { rerender } = renderGroup([resultFor('a')], true)
    expect(screen.getByRole('button', { name: /Read 3 files/ })).toHaveAttribute('aria-expanded', 'false')

    const resultMap = new Map(['a', 'b', 'c'].map((id) => [id, resultFor(id)]))
    rerender(
      <ToolCallGroup
        toolCalls={['a', 'b', 'c'].map(readCall)}
        resultMap={resultMap}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
      />,
    )
    expect(screen.getByRole('button', { name: /Read 3 files/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps a group with a failed call collapsed and marks it as failed', () => {
    renderGroup([resultFor('a'), resultFor('b', true), resultFor('c')])

    const header = screen.getByRole('button', { name: /Read 3 files/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(header.querySelector('.text-\\[var\\(--color-error\\)\\]')).not.toBeNull()
  })

  it('folds thinking into the group summary and shows it as running while it streams', () => {
    const toolCalls = ['a', 'b'].map(readCall)
    const thinking = { id: 'think-1', type: 'thinking', content: 'Checking the second file', timestamp: 1 } as const
    const resultMap = new Map(['a', 'b'].map((id) => [id, resultFor(id)]))
    render(
      <ToolCallGroup
        toolCalls={toolCalls}
        steps={[toolCalls[0]!, thinking, toolCalls[1]!]}
        activeThinkingId="think-1"
        resultMap={resultMap}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
      />,
    )

    const header = screen.getByRole('button', { name: /Read 2 files, thought once/ })
    expect(header.querySelector('.animate-pulse-dot')).not.toBeNull()
    fireEvent.click(header)
    expect(screen.getByText('Checking the second file')).toBeInTheDocument()
  })

  it('expands and collapses a memory reference card from its header', () => {
    const memoryRead: ToolCall = {
      id: 'msg-memory',
      type: 'tool_use',
      toolName: 'Read',
      toolUseId: 'memory',
      input: { file_path: '/repo/memory/preferences.md' },
      timestamp: 1,
    }
    render(
      <ToolCallGroup
        toolCalls={[memoryRead]}
        resultMap={new Map([['memory', resultFor('memory')]])}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
      />,
    )

    const header = screen.getByRole('button', { name: /1 memory reference/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '/repo/memory/preferences.md' })).not.toBeInTheDocument()
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '/repo/memory/preferences.md' })).toBeInTheDocument()
    fireEvent.click(header)
    expect(screen.queryByRole('button', { name: '/repo/memory/preferences.md' })).not.toBeInTheDocument()
  })

  it('expands and collapses an agent card from its chevron button', () => {
    const agentCall: ToolCall = {
      id: 'msg-agent',
      type: 'tool_use',
      toolName: 'Agent',
      toolUseId: 'agent',
      input: { description: 'Scan the repo' },
      timestamp: 1,
    }
    render(
      <ToolCallGroup
        toolCalls={[agentCall]}
        resultMap={new Map([['agent', resultFor('agent')]])}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
      />,
    )

    expect(screen.queryByText('No tool activity yet')).not.toBeInTheDocument()
    const expand = screen.getByRole('button', { name: 'Expand agent' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Collapse agent' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('No tool activity yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse agent' }))
    expect(screen.queryByText('No tool activity yet')).not.toBeInTheDocument()
  })
})
