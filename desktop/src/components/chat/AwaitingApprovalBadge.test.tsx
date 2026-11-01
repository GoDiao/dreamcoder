import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AwaitingApprovalBadge } from './AwaitingApprovalBadge'
import { useSettingsStore } from '../../stores/settingsStore'

describe('AwaitingApprovalBadge', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the awaiting approval label', () => {
    render(<AwaitingApprovalBadge />)
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument()
  })

  it('follows the interface language', () => {
    useSettingsStore.setState({ locale: 'zh' })
    render(<AwaitingApprovalBadge />)
    expect(screen.queryByText('Awaiting approval')).not.toBeInTheDocument()
    expect(screen.getByText('等待审批')).toBeInTheDocument()
  })
})
