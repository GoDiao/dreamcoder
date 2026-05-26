import React, { useMemo, useState } from 'react'
import { Box, Link, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import { ConsoleOAuthFlow } from './ConsoleOAuthFlow.js'
import { Select } from './CustomSelect/select.js'
import { OpenAILoginFlow } from './OpenAILoginFlow.js'

type Props = {
  onDone(): void
  startingMessage?: string
}

type LoginSelection = 'claudeai' | 'console' | 'openai' | 'platform' | 'idle'

function PlatformSetupFlow({
  onBack,
}: {
  onBack(): void
}): React.ReactNode {
  useKeybinding(
    'confirm:yes',
    () => {
      onBack()
    },
    {
      context: 'Confirmation',
      isActive: true,
    },
  )

  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      <Text bold>Using 3rd-party platforms</Text>
      <Text>
        Claude Code supports Amazon Bedrock, Microsoft Foundry, and Vertex AI.
        Set the required environment variables, then restart Claude Code.
      </Text>
      <Text>
        If you are part of an enterprise organization, contact your
        administrator for setup instructions.
      </Text>
      <Box flexDirection="column">
        <Text bold>Documentation:</Text>
        <Text>
          · Amazon Bedrock:{' '}
          <Link url="https://code.claude.com/docs/en/amazon-bedrock" />
        </Text>
        <Text>
          · Microsoft Foundry:{' '}
          <Link url="https://code.claude.com/docs/en/microsoft-foundry" />
        </Text>
        <Text>
          · Vertex AI:{' '}
          <Link url="https://code.claude.com/docs/en/google-vertex-ai" />
        </Text>
      </Box>
      <Text dimColor>
        Press <Text bold>Enter</Text> to go back to login options.
      </Text>
    </Box>
  )
}

export function SlashLoginFlow({
  onDone,
  startingMessage,
}: Props): React.ReactNode {
  const settings = getSettings_DEPRECATED() || {}
  const forceLoginMethod = settings.forceLoginMethod

  const [selection, setSelection] = useState<LoginSelection>(() => {
    if (forceLoginMethod === 'claudeai' || forceLoginMethod === 'console') {
      return forceLoginMethod
    }
    return 'idle'
  })

  const options = useMemo(
    () => [
      {
        label: (
          <Text>
            Claude account with subscription ·{' '}
            <Text dimColor>Pro, Max, Team, or Enterprise</Text>
            {'\n'}
          </Text>
        ),
        value: 'claudeai' as const,
      },
      {
        label: (
          <Text>
            Anthropic Console account ·{' '}
            <Text dimColor>API usage billing</Text>
            {'\n'}
          </Text>
        ),
        value: 'console' as const,
      },
      {
        label: (
          <Text>
            OpenAI account · <Text dimColor>ChatGPT Pro/Plus</Text>
            {'\n'}
          </Text>
        ),
        value: 'openai' as const,
      },
      {
        label: (
          <Text>
            3rd-party platform ·{' '}
            <Text dimColor>Amazon Bedrock, Microsoft Foundry, or Vertex AI</Text>
            {'\n'}
          </Text>
        ),
        value: 'platform' as const,
      },
    ],
    [],
  )

  if (selection === 'claudeai' || selection === 'console') {
    return (
      <ConsoleOAuthFlow
        onDone={onDone}
        startingMessage={startingMessage}
        forceLoginMethod={selection}
      />
    )
  }

  if (selection === 'openai') {
    return <OpenAILoginFlow onDone={onDone} startingMessage={startingMessage} />
  }

  if (selection === 'platform') {
    return <PlatformSetupFlow onBack={() => setSelection('idle')} />
  }

  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      <Text bold>
        {startingMessage ??
          'Claude Code can be used with your Claude subscription, Anthropic Console billing, or your ChatGPT subscription.'}
      </Text>
      <Text>Select login method:</Text>
      <Box>
        <Select
          options={options}
          onChange={value => setSelection(value as LoginSelection)}
        />
      </Box>
    </Box>
  )
}
