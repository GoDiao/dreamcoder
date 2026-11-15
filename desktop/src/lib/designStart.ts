import { designApi } from '../api/design'
import { t as translate, type TranslationKey } from '../i18n'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'

export type StartCommand = '/design' | '/slides'

export type DesignStart = {
  command: StartCommand
  project: string
  template?: { id: string; title: string }
  designSystem?: { id: string; name: string }
  cloneAddress?: string
}

type Translate = typeof translate

export async function openDesignStart(start: DesignStart) {
  const sessionId = await useSessionStore.getState().createSession(start.project)
  useChatStore.getState().connectToSession(sessionId)
  useWorkspaceChatContextStore.getState().setStart(sessionId, start)
  const title = useSessionStore.getState().sessions.find((session) => session.id === sessionId)?.title ?? ''
  useTabStore.getState().openTab(sessionId, title)
  return sessionId
}

export async function prepareDesignStart(sessionId: string, start: DesignStart) {
  const { command, project, template, designSystem, cloneAddress } = start
  if (cloneAddress) return `${command} ${translate('design.cloneTitle')} ${cloneAddress}`
  const artifact = template
    ? await designApi.createArtifact({ project, templateId: template.id, title: template.title, ...(designSystem && { designSystemId: designSystem.id }) })
    : null
  const system = !artifact && designSystem ? await designApi.installSystem(sessionId, designSystem.id) : null
  const target = artifact?.dir ?? system?.dir
  return target ? `${command} ${target}` : command
}

function cloneTarget(address: string) {
  const url = new URL(address)
  return url.pathname === '/' ? url.host : `${url.host}${url.pathname}`
}

export function designStartLabel(start: DesignStart, t: Translate) {
  if (start.cloneAddress) return t('start.chip.clone', { address: cloneTarget(start.cloneAddress) })
  return [
    t(start.command === '/slides' ? 'slides.entry' : 'design.entry'),
    start.template?.title,
    start.designSystem && t('design.systemChip', { name: start.designSystem.name }),
  ].filter(Boolean).join(' · ')
}

export function designStartPlaceholder(start: DesignStart): TranslationKey {
  if (start.cloneAddress) return 'start.placeholder.clone'
  return start.command === '/slides' ? 'start.placeholder.slides' : 'start.placeholder.design'
}
