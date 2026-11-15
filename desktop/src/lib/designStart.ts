import { designApi } from '../api/design'
import { t as translate, type TranslationKey } from '../i18n'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useWorkspaceChatContextStore } from '../stores/workspaceChatContextStore'

const START_COMMANDS = ['/design', '/slides'] as const

export type StartCommand = (typeof START_COMMANDS)[number]

export type DesignStart = {
  command: StartCommand
  template?: { id: string; title: string; project: string }
  designSystem?: { id: string; name: string }
  cloneAddress?: string
}

type Translate = typeof translate

export const DESIGN_START_ATTACHMENT_ID = 'design-start'

export function designStartAttachment(start: DesignStart, t: Translate) {
  return { id: DESIGN_START_ATTACHMENT_ID, type: 'artifact' as const, name: designStartLabel(start, t) }
}

export async function openDesignStart(project: string, start: DesignStart) {
  const sessionId = await useSessionStore.getState().createSession(project)
  useChatStore.getState().connectToSession(sessionId)
  useWorkspaceChatContextStore.getState().setStart(sessionId, start)
  const title = useSessionStore.getState().sessions.find((session) => session.id === sessionId)?.title ?? ''
  useTabStore.getState().openTab(sessionId, title)
  return sessionId
}

export async function prepareDesignStart(sessionId: string, start: DesignStart) {
  const { command, template, designSystem, cloneAddress } = start
  if (cloneAddress) return `${command} ${translate('design.cloneTitle')} ${cloneAddress}`
  const artifact = template
    ? await designApi.createArtifact({ project: template.project, templateId: template.id, title: template.title, ...(designSystem && { designSystemId: designSystem.id }) })
    : null
  const system = !artifact && designSystem ? await designApi.installSystem(sessionId, designSystem.id) : null
  const target = artifact?.dir ?? system?.dir
  return target ? `${command} ${target}` : command
}

export async function designStartMessage(sessionId: string, start: DesignStart, text: string) {
  const command = await prepareDesignStart(sessionId, start)
  const name = designStartLabel(start, translate)
  return {
    content: [command, text].filter(Boolean).join(' '),
    displayContent: text,
    chip: { type: 'artifact' as const, name },
    title: text || name,
  }
}

export function designStartOfCommand(name: string): DesignStart | null {
  const command = START_COMMANDS.find((candidate) => candidate === `/${name}`)
  return command ? { command } : null
}

export function typedDesignStart(value: string, { complete }: { complete: boolean }) {
  const match = /^\s*\/(\S+)(\s+|$)([\s\S]*)$/.exec(value)
  const start = match ? designStartOfCommand(match[1]!) : null
  if (!match || !start || (!complete && !match[2])) return null
  return { start, rest: match[3]! }
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
