import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { AdapterSettings } from './AdapterSettings'
import { useAdapterStore } from '../stores/adapterStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { AdapterFileConfig } from '../types/adapter'

const FEISHU_CREATE_BOT_URL = 'https://open.feishu.cn/page/openclaw?form=multiAgent'

function renderAdapterSettings(config: AdapterFileConfig) {
  useSettingsStore.setState({ locale: 'en' })
  useAdapterStore.setState({
    config,
    isLoading: false,
    fetchConfig: vi.fn(async () => {}),
  } as Partial<ReturnType<typeof useAdapterStore.getState>>)

  render(<AdapterSettings />)
}

afterEach(() => {
  cleanup()
  useAdapterStore.setState(useAdapterStore.getInitialState(), true)
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

describe('AdapterSettings Feishu onboarding', () => {
  it('shows the documented one-click Feishu bot link before credentials are configured', () => {
    renderAdapterSettings({})

    expect(screen.getByText('Need a Feishu bot?')).toBeInTheDocument()
    expect(screen.getByText(/OpenClaw template/)).toBeInTheDocument()
    expect(screen.getByText('1. Create the bot from the template.')).toBeInTheDocument()
    expect(screen.getByText('2. Copy its App ID and App Secret, then fill them in here.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create feishu bot/i })).toHaveAttribute(
      'href',
      FEISHU_CREATE_BOT_URL,
    )
  })

  it('hides the one-click Feishu bot prompt once saved credentials exist', () => {
    renderAdapterSettings({
      feishu: {
        appId: 'cli_existing',
        appSecret: '****cret',
      },
    })

    expect(screen.queryByRole('link', { name: /create feishu bot/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Need a Feishu bot?')).not.toBeInTheDocument()
  })
})
