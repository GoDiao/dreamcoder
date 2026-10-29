import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { CopyButton } from './CopyButton'
import { copyTextToClipboard } from '../chat/clipboard'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { toast } from 'sonner'

vi.mock('../chat/clipboard', () => ({ copyTextToClipboard: vi.fn() }))

const copy = vi.mocked(copyTextToClipboard)

describe('CopyButton', () => {
  const settings = useSettingsStore.getState()
  const ui = useUIStore.getState()

  beforeEach(() => {
    vi.useFakeTimers()
    useSettingsStore.setState({ locale: 'zh' })
    copy.mockReset().mockResolvedValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    useSettingsStore.setState(settings)
    useUIStore.setState(ui)
  })

  it('localizes success feedback and restores the copy action', async () => {
    render(<CopyButton text="full content" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制' })) })
    expect(copy).toHaveBeenCalledWith('full content')
    expect(screen.getByRole('button', { name: '已复制' })).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.getByRole('button', { name: '复制' })).toBeVisible()
  })

  it('supports icon-only chat actions with localized feedback', async () => {
    const onClick = vi.fn()
    render(<CopyButton text="full reply" iconOnly onClick={onClick} />)
    const button = screen.getByRole('button', { name: '复制' })
    expect(button.textContent).toBe('')
    await act(async () => { fireEvent.click(button) })
    expect(copy).toHaveBeenCalledWith('full reply')
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '已复制' }).querySelector('svg')).not.toBeNull()
  })

  it('reports clipboard failure', async () => {
    copy.mockResolvedValue(false)
    render(<CopyButton text="full content" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制' })) })
    expect(screen.queryByRole('button', { name: '已复制' })).toBeNull()
    expect(toast.error).toHaveBeenCalledOnce()
  })
})
