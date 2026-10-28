import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskRow } from './TaskRow'
import { Modal } from '../shared/Modal'
import { useTaskStore } from '../../stores/taskStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { CronTask } from '../../types/task'

vi.mock('./NewTaskModal', () => ({
  NewTaskModal: ({ onClose, editTask }: { onClose: () => void; editTask: CronTask }) => <Modal open title="Edit task" onClose={onClose}>{editTask.name}</Modal>,
}))

const initialTasks = useTaskStore.getState()
const initialSettings = useSettingsStore.getState()
const task: CronTask = { id: 'task-1', name: 'Daily report', cron: '0 9 * * *', prompt: 'Summarize', enabled: true, createdAt: 0 }
const runTask = vi.fn()
const updateTask = vi.fn()
const deleteTask = vi.fn()

beforeEach(() => {
  runTask.mockReset().mockResolvedValue(undefined)
  updateTask.mockReset().mockResolvedValue(undefined)
  deleteTask.mockReset().mockResolvedValue(undefined)
  useTaskStore.setState({ runTask, updateTask, deleteTask })
  useSettingsStore.setState({ locale: 'en' })
})

afterEach(() => {
  cleanup()
  useTaskStore.setState(initialTasks, true)
  useSettingsStore.setState(initialSettings, true)
})

async function openMenu(label = 'Task actions') {
  const trigger = screen.getByRole('button', { name: label })
  act(() => trigger.focus())
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  await screen.findByRole('menu')
  return trigger
}

async function selectAction(label: string, triggerLabel = 'Task actions') {
  const trigger = await openMenu(triggerLabel)
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
  const dialog = await screen.findByRole('alertdialog', { name: label })
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  return { trigger, dialog }
}

describe('TaskRow overlays', () => {
  it('navigates the menu by keyboard and restores focus on Escape', async () => {
    render(<TaskRow task={task} showLogs={false} onToggleLogs={vi.fn()} />)
    const trigger = await openMenu()
    const edit = screen.getByRole('menuitem', { name: 'Edit' })
    await waitFor(() => expect(edit).toHaveFocus())
    fireEvent.keyDown(edit, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Disable' })).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the editor after the menu closes and returns to its trigger', async () => {
    render(<TaskRow task={task} showLogs={false} onToggleLogs={vi.fn()} />)
    const trigger = await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' })
    expect(dialog).toHaveTextContent(task.name)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('cancels deletion without a mutation and returns focus to the menu trigger', async () => {
    render(<TaskRow task={task} showLogs={false} onToggleLogs={vi.fn()} />)
    const { trigger, dialog } = await selectAction('Delete')
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(cancel).toHaveFocus())
    fireEvent.click(cancel)
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(deleteTask).not.toHaveBeenCalled()
  })

  it('deletes only the selected task after confirmation', async () => {
    render(<TaskRow task={task} showLogs={false} onToggleLogs={vi.fn()} />)
    const { dialog } = await selectAction('Delete')
    expect(deleteTask).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(deleteTask).toHaveBeenCalledExactlyOnceWith(task.id)
  })

  it.each([true, false])('confirms the opposite enabled state when enabled is %s', async (enabled) => {
    render(<TaskRow task={{ ...task, enabled }} showLogs={false} onToggleLogs={vi.fn()} />)
    const label = enabled ? 'Disable' : 'Enable'
    const { dialog } = await selectAction(label)
    fireEvent.click(within(dialog).getByRole('button', { name: label }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(updateTask).toHaveBeenCalledExactlyOnceWith(task.id, { enabled: !enabled })
  })

  it('blocks repeated run requests and dismissal until the request completes', async () => {
    let resolveRun!: () => void
    runTask.mockReturnValue(new Promise<void>((resolve) => { resolveRun = resolve }))
    const onToggleLogs = vi.fn()
    render(<TaskRow task={task} showLogs={false} onToggleLogs={onToggleLogs} />)
    const trigger = screen.getByRole('button', { name: 'Run now' })
    act(() => trigger.focus())
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('alertdialog', { name: 'Run now' })
    const confirm = within(dialog).getByRole('button', { name: 'Run now' })
    fireEvent.click(confirm)
    expect(confirm).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.click(confirm)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dialog).toBeInTheDocument()
    expect(runTask).toHaveBeenCalledExactlyOnceWith(task.id)
    expect(onToggleLogs).toHaveBeenCalledOnce()
    await act(async () => resolveRun())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it.each([
    ['en', 'Task actions', 'Delete', 'Could not complete the task action: offline'],
    ['zh', '任务操作', '删除', '任务操作失败：offline'],
  ] as const)('keeps a failed confirmation open for retry in %s', async (locale, triggerLabel, label, error) => {
    useSettingsStore.setState({ locale })
    deleteTask.mockRejectedValueOnce(new Error('offline'))
    render(<TaskRow task={task} showLogs={false} onToggleLogs={vi.fn()} />)
    const { dialog } = await selectAction(label, triggerLabel)
    fireEvent.click(within(dialog).getByRole('button', { name: label }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(error)
    expect(within(dialog).getByRole('button', { name: label })).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: label }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(deleteTask).toHaveBeenCalledTimes(2)
  })
})
