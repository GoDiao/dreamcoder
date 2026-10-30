import { ArrowLeftIcon, BrainIcon, ChevronRight, CircleAlertIcon, FileTextIcon, LayersIcon, WrenchIcon, ZapIcon } from 'lucide-react'
import { Button } from '../shared/ui/button'
import { LoadingBlock } from '../shared/LoadingBlock'
import { useEffect, useMemo, type ReactNode } from 'react'
import { useAgentStore } from '../../stores/agentStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { SettingsPageHeader } from './SettingsPageHeader'
import { DetailStat, SettingsSection, SettingsSummary } from './SettingsSummary'
import type { AgentDefinition, AgentSource } from '../../api/agents'

const AGENT_COLORS: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  cyan: '#06b6d4',
}

const AGENT_SOURCE_ORDER: AgentSource[] = [
  'userSettings',
  'claudeCode',
  'projectSettings',
  'localSettings',
  'policySettings',
  'plugin',
  'flagSettings',
  'built-in',
]

function getAgentDotColor(color?: string) {
  return color && AGENT_COLORS[color] ? AGENT_COLORS[color] : 'var(--color-text-tertiary)'
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[4px] bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
      {children}
    </span>
  )
}

function AgentDetailView({ agent, onBack }: { agent: AgentDefinition; onBack: () => void }) {
  const t = useTranslation()
  const sourceLabel = t(`settings.agents.source.${agent.source}`)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 min-w-0">
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
        >
          <ArrowLeftIcon aria-hidden="true" size={16} />
          {t('settings.agents.backToList')}
        </button>
      </div>

      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:items-start">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
              {t('settings.agents.entryEyebrow')}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span
                className="h-3 w-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: getAgentDotColor(agent.color) }}
              />
              <h3 className="text-[22px] font-semibold leading-tight text-[var(--color-text-primary)] break-all">
                {agent.agentType}
              </h3>
              <MetaPill>{sourceLabel}</MetaPill>
              {agent.modelDisplay && <MetaPill>{agent.modelDisplay}</MetaPill>}
              <MetaPill>
                {agent.isActive
                  ? t('settings.agents.status.active')
                  : t('settings.agents.status.available')}
              </MetaPill>
              {agent.overriddenBy && (
                <MetaPill>
                  {t('settings.agents.overriddenByShort', {
                    source: t(`settings.agents.source.${agent.overriddenBy}`),
                  })}
                </MetaPill>
              )}
            </div>
            <div className="max-w-4xl text-sm leading-6 text-[var(--color-text-secondary)]">
              <MarkdownRenderer
                content={agent.description || t('settings.agents.noDescription')}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--color-text-tertiary)]">
              <span>
                {agent.tools?.length
                  ? t('settings.agents.toolCount', { count: String(agent.tools.length) })
                  : t('settings.agents.noTools')}
              </span>
              {agent.baseDir && <span className="break-all">{agent.baseDir}</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <DetailStat
              label={t('settings.agents.summary.source')}
              value={sourceLabel}
              icon={LayersIcon}
            />
            <DetailStat
              label={t('settings.agents.summary.model')}
              value={agent.modelDisplay || '—'}
              icon={BrainIcon}
            />
            <DetailStat
              label={t('settings.agents.summary.tools')}
              value={String(agent.tools?.length ?? 0)}
              icon={WrenchIcon}
            />
            <DetailStat
              label={t('settings.agents.summary.status')}
              value={agent.isActive ? t('settings.agents.status.active') : t('settings.agents.status.available')}
              icon={ZapIcon}
            />
          </div>
        </div>
      </section>

      {agent.tools && agent.tools.length > 0 && (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <WrenchIcon className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" size={18} />
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.agents.tools')}
            </h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {agent.tools.map((tool) => (
              <MetaPill key={tool}>{tool}</MetaPill>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-1 min-h-0 min-w-0 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-[var(--color-text-secondary)] break-all">
                  {agent.baseDir || sourceLabel}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                {t('settings.agents.promptHint')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] border border-[var(--color-border)]">
                {t('settings.agents.systemPrompt')}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface-container-lowest)]">
            {agent.systemPrompt ? (
              <div className="px-6 py-5 lg:px-8">
                <MarkdownRenderer
                  content={agent.systemPrompt}
                  variant="document"
                  className="mx-auto max-w-[72ch]"
                />
              </div>
            ) : (
              <div className="px-6 py-10 text-center">
                <FileTextIcon className="mx-auto shrink-0 text-[var(--color-text-tertiary)] mb-2 block" aria-hidden="true" size={32} />
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  {t('settings.agents.noSystemPrompt')}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export function AgentsSettings() {
  const {
    activeAgents,
    allAgents,
    isLoading,
    error,
    selectedAgent,
    selectedAgentReturnTab,
    fetchAgents,
    selectAgent,
  } = useAgentStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  useEffect(() => {
    void fetchAgents(currentWorkDir)
  }, [fetchAgents, currentWorkDir])

  const groupedAgents = useMemo(() => {
    const groups: Partial<Record<AgentSource, AgentDefinition[]>> = {}
    for (const agent of allAgents) {
      ;(groups[agent.source] ??= []).push(agent)
    }
    return groups
  }, [allAgents])

  const sourceCount = AGENT_SOURCE_ORDER.filter((source) => (groupedAgents[source] ?? []).length > 0).length

  const handleAgentBack = () => {
    const returnTab = selectedAgentReturnTab
    selectAgent(null)
    if (returnTab === 'plugins') {
      useUIStore.getState().openSettings('plugins')
    }
  }

  if (selectedAgent) {
    return (
      <div className="w-full min-w-0">
        <AgentDetailView agent={selectedAgent} onBack={handleAgentBack} />
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <SettingsPageHeader title={t('settings.agents.title')} description={t('settings.agents.description')} />
      {isLoading && allAgents.length === 0 ? (
        <LoadingBlock />
      ) : error ? (
        <div className="text-center py-12 px-4">
          <CircleAlertIcon className="mx-auto shrink-0 text-[var(--color-error)] mb-3 block" aria-hidden="true" size={40} />
          <p className="text-sm text-[var(--color-error)] mb-2">{error}</p>
          <button
            onClick={() => void fetchAgents(currentWorkDir)}
            className="text-xs text-[var(--color-text-accent)] hover:underline"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : allAgents.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.agents.empty')}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.agents.emptyHint')}</p>
        </div>
      ) : (
        <>
          <SettingsSummary
            items={[
              { label: t('settings.agents.summary.totalAgents'), value: allAgents.length },
              { label: t('settings.agents.summary.activeAgents'), value: activeAgents.length },
              { label: t('settings.agents.summary.sources'), value: sourceCount },
            ]}
          />

          {AGENT_SOURCE_ORDER.map((source) => {
            const group = groupedAgents[source]
            if (!group?.length) return null

            const sourceLabel = t(`settings.agents.source.${source}`)
            return (
              <SettingsSection key={source} title={sourceLabel} count={group.length}>
                {group.map((agent) => (
                  <Button
                    key={`${agent.source}-${agent.agentType}`}
                    variant="ghost"
                    size="row"
                    onClick={() => selectAgent(agent, 'agents')}
                    className="group gap-3 rounded-none border-0 border-b border-[var(--color-border-separator)] px-0 py-2.5"
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: getAgentDotColor(agent.color) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="break-all text-[13px] font-medium text-[var(--color-text-primary)]">
                          {agent.agentType}
                        </span>
                        {agent.modelDisplay && <MetaPill>{agent.modelDisplay}</MetaPill>}
                        <MetaPill>
                          {agent.isActive
                            ? t('settings.agents.status.active')
                            : t('settings.agents.status.available')}
                        </MetaPill>
                        {agent.overriddenBy && (
                          <MetaPill>
                            {t('settings.agents.overriddenBy', {
                              source: t(`settings.agents.source.${agent.overriddenBy}`),
                            })}
                          </MetaPill>
                        )}
                      </span>
                      <span className="mt-px block break-words text-xs leading-[1.5] text-[var(--color-text-secondary)] [&_.prose]:text-xs [&_.prose]:leading-[1.5] [&_.prose]:text-[var(--color-text-secondary)] [&_p]:my-0">
                        <MarkdownRenderer
                          content={agent.description || t('settings.agents.noDescription')}
                        />
                      </span>
                      <span className="mt-px block text-[11px] text-[var(--color-text-tertiary)]">
                        {agent.tools?.length
                          ? t('settings.agents.toolCount', { count: String(agent.tools.length) })
                          : t('settings.agents.noTools')}
                        {agent.baseDir ? <span className="break-all"> · {agent.baseDir}</span> : null}
                      </span>
                    </span>
                    <ChevronRight size={14} aria-hidden="true" className="mr-1 flex-shrink-0 text-[var(--color-text-tertiary)]" />
                  </Button>
                ))}
              </SettingsSection>
            )
          })}
        </>
      )}
    </div>
  )
}
