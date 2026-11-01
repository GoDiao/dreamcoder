import { designApi } from '../api/design'
import { t } from '../i18n'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'

export type DesignStart = {
  template?: { id: string; title: string }
  designSystemId?: string
  cloneAddress?: string
}

export async function startDesignSession(project: string, start: DesignStart = {}) {
  const { template, designSystemId, cloneAddress } = start
  const artifact = template
    ? await designApi.createArtifact({ project, templateId: template.id, title: template.title, ...(designSystemId && { designSystemId }) })
    : null
  const sessionId = await useSessionStore.getState().createSession(project)
  const system = !artifact && designSystemId ? await designApi.installSystem(sessionId, designSystemId) : null
  useChatStore.getState().connectToSession(sessionId)
  const target = artifact?.dir ?? system?.dir
  const message = cloneAddress ? `/design ${t('design.cloneTitle')} ${cloneAddress}` : target ? `/design ${target}` : '/design'
  useChatStore.getState().sendMessage(sessionId, message, [])
  const title = useSessionStore.getState().sessions.find((session) => session.id === sessionId)?.title ?? ''
  useTabStore.getState().openTab(sessionId, title)
  return sessionId
}
