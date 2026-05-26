import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { logEvent } from '../../services/analytics/index.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { LogOption } from '../../types/logs.js'
import { getTranscriptPath } from '../../utils/sessionStorage.js'
import {
  createSessionBranch,
  deriveFirstPrompt,
} from '../../utils/sessionBranching.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const customTitle = args?.trim() || undefined
  const originalSessionId = getSessionId()

  try {
    const {
      sessionId,
      title,
      forkPath,
      workDir,
      serializedMessages,
      contentReplacementRecords,
    } = await createSessionBranch({
      sourceSessionId: originalSessionId,
      sourceTranscriptPath: getTranscriptPath(),
      title: customTitle,
      sourceWorkDir: getOriginalCwd(),
    })

    const now = new Date()
    const firstPrompt = deriveFirstPrompt(
      serializedMessages.find(
        (message): message is Extract<typeof serializedMessages[number], { type: 'user' }> =>
          message.type === 'user',
      ),
    )
    const forkLog: LogOption = {
      date: now.toISOString().split('T')[0]!,
      messages: serializedMessages,
      fullPath: forkPath,
      value: now.getTime(),
      created: now,
      modified: now,
      firstPrompt,
      messageCount: serializedMessages.length,
      isSidechain: false,
      sessionId,
      customTitle: title,
      contentReplacements: contentReplacementRecords,
    }

    logEvent('tengu_conversation_forked', {
      message_count: serializedMessages.length,
      has_custom_title: !!customTitle,
    })

    const titleInfo = customTitle ? ` "${customTitle}"` : ''
    const resumeHint = `\nTo resume the original: claude -r ${originalSessionId}`
    const successMessage = `Branched conversation${titleInfo}. You are now in the branch.${resumeHint}`

    if (context.resume) {
      await context.resume(sessionId, forkLog, 'fork')
      onDone(successMessage, { display: 'system' })
    } else {
      onDone(
        `Branched conversation${titleInfo}. Resume with: /resume ${sessionId}`,
      )
    }

    return null
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred'
    onDone(`Failed to branch conversation: ${message}`)
    return null
  }
}
