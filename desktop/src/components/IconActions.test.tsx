import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalSlashCommandPanel } from './chat/LocalSlashCommandPanel'
import { BashPathSettings } from './settings/BashPathSettings'
import { TaskRow } from './tasks/TaskRow'
import { TaskRunsPanel } from './tasks/TaskRunsPanel'
import { useSettingsStore } from '../stores/settingsStore'
import { useTaskStore } from '../stores/taskStore'

const { pickFile } = vi.hoisted(() => ({ pickFile: vi.fn() }))
vi.mock('../lib/shell', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/shell')>(),
  pickFile,
}))

const originalSettings = useSettingsStore.getState()
const originalTasks = useTaskStore.getState()

beforeEach(() => {
  pickFile.mockReset()
  useSettingsStore.setState({ desktopTerminal: { startupShell: 'system', customShellPath: '', bashPath: null } })
  useTaskStore.setState({ fetchTaskRuns: vi.fn(async () => []) })
})

afterEach(() => {
  cleanup()
  useSettingsStore.setState(originalSettings, true)
  useTaskStore.setState(originalTasks, true)
})

describe.each([
  { locale: 'en', close: 'Close', browse: 'Choose Bash executable', actions: 'Task actions', run: 'Run now', logs: 'Logs', edit: 'Edit' },
  { locale: 'zh', close: '关闭', browse: '选择 Bash 可执行文件', actions: '任务操作', run: '立即执行', logs: '日志', edit: '编辑' },
] as const)('icon actions in $locale', (labels) => {
  beforeEach(() => { useSettingsStore.setState({ locale: labels.locale }) })

  it('closes the slash-command panel through its named control', () => {
    const onClose = vi.fn()
    render(<LocalSlashCommandPanel command="help" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: labels.close }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('selects a Bash executable through its named control', async () => {
    pickFile.mockResolvedValue('/tools/bash')
    render(<BashPathSettings />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: labels.browse })))
    expect(pickFile).toHaveBeenCalledOnce()
    expect(screen.getByRole('textbox')).toHaveValue('/tools/bash')
  })

  it('keeps task actions named when the run action is disabled', async () => {
    const onToggleLogs = vi.fn()
    render(<TaskRow task={{ id: 'task-1', name: 'Daily report', cron: '0 9 * * *', prompt: 'Summarize', enabled: false, createdAt: 0 }} showLogs={false} onToggleLogs={onToggleLogs} />)
    expect(screen.getByRole('button', { name: labels.run })).toBeDisabled()
    const actions = screen.getByRole('button', { name: labels.actions })
    expect(actions).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(actions, { key: 'ArrowDown' })
    const edit = await screen.findByRole('menuitem', { name: labels.edit })
    expect(actions).toHaveAttribute('aria-expanded', 'true')
    expect(edit).toBeVisible()
    fireEvent.keyDown(edit, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: labels.logs }))
    expect(onToggleLogs).toHaveBeenCalledOnce()
  })

  it('closes task logs through its named control', async () => {
    const onClose = vi.fn()
    render(<TaskRunsPanel taskId="task-1" onClose={onClose} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: labels.close })))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
