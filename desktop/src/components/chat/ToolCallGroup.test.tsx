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

  it('opens a group with a failed call', () => {
    renderGroup([resultFor('a'), resultFor('b', true), resultFor('c')])

    expect(screen.getByRole('button', { name: /Read 3 files/ })).toHaveAttribute('aria-expanded', 'true')
  })
})
