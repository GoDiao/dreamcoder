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
    renderGroup([resultFor('a'), resultFor('b'), resultFor('c', true)])

    const header = screen.getByRole('button', { name: /Read 3 files/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(header.querySelector('.text-\\[var\\(--color-error\\)\\]')).not.toBeNull()
  })

  it('does not mark the group as failed when a later call of the same tool succeeded, but keeps the failed row', () => {
    renderGroup([resultFor('a', true), resultFor('b', true), resultFor('c')])

    const header = screen.getByRole('button', { name: /Read 3 files/ })
    expect(header.querySelector('.text-\\[var\\(--color-error\\)\\]')).toBeNull()
    fireEvent.click(header)
    expect(screen.getAllByText('boom')).toHaveLength(2)
  })

  it('names what each ShowUI call did instead of showing its raw result', () => {
    const calls: ToolCall[] = [
      { id: 'm1', type: 'tool_use', toolName: 'ShowUI', toolUseId: 's1', input: { catalog: true }, timestamp: 1 },
      { id: 'm2', type: 'tool_use', toolName: 'ShowUI', toolUseId: 's2', input: { describe: ['flowchart', 'html'] }, timestamp: 1 },
      { id: 'm3', type: 'tool_use', toolName: 'ShowUI', toolUseId: 's3', input: { title: 'Plan', blocks: [] }, timestamp: 1 },
      { id: 'm4', type: 'tool_use', toolName: 'ShowUI', toolUseId: 's4', input: { pageId: 'a1b2c3d4e5f6a1b2c3d4e5f6', baseRevision: 1, operations: [] }, timestamp: 1 },
    ]
    const page = (revision: number) => JSON.stringify({ pageId: 'a1b2c3d4e5f6a1b2c3d4e5f6', revision, title: 'Plan', blocks: [] })
    const results: ToolResult[] = [
      { ...resultFor('s1'), content: JSON.stringify({ note: 'The component documentation below is written in Chinese.', components: [] }) },
      { ...resultFor('s2'), content: JSON.stringify({ note: 'x', components: [] }) },
      { ...resultFor('s3'), content: page(1) },
      { ...resultFor('s4'), content: page(2) },
    ]
    render(
      <ToolCallGroup
        toolCalls={calls}
        resultMap={new Map(results.map((result) => [result.toolUseId, result]))}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /ShowUI/ }))

    expect(screen.getByText('List components')).toBeInTheDocument()
    expect(screen.getByText('Read the format of flowchart, html')).toBeInTheDocument()
    expect(screen.getByText('Create a page')).toBeInTheDocument()
    expect(screen.getByText('Update a page')).toBeInTheDocument()
    expect(screen.getByText('Plan · rev 1')).toBeInTheDocument()
    expect(screen.getByText('Plan · rev 2')).toBeInTheDocument()
    expect(screen.queryByText(/component documentation/)).toBeNull()
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
