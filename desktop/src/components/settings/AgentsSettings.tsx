import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { useAgentStore } from '../../stores/agentStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
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

function getAgentSourceIcon(source: AgentSource) {
  switch (source) {
    case 'userSettings':
      return 'person'
    case 'projectSettings':
      return 'folder'
    case 'localSettings':
      return 'folder_lock'
    case 'policySettings':
      return 'shield'
    case 'plugin':
      return 'extension'
    case 'flagSettings':
      return 'terminal'
    case 'built-in':
      return 'inventory_2'
  }
}

function getAgentSourceAccentClass(source: AgentSource) {
  switch (source) {
    case 'userSettings':
      return 'bg-[var(--color-primary-fixed)] text-[var(--color-brand)]'
    case 'projectSettings':
      return 'bg-[var(--color-success-container)] text-[var(--color-success)]'
    case 'localSettings':
      return 'bg-[var(--color-info-container)] text-[var(--color-info)]'
    case 'policySettings':
      return 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
    case 'plugin':
      return 'bg-[var(--color-warning-container)] text-[var(--color-warning)]'
    case 'flagSettings':
      return 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
    case 'built-in':
      return 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
  }
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
      {children}
    </span>
  )
}

function SummaryCard({
  label,
  value,
  icon,
  className = '',
}: {
  label: string
  value: string
  icon: string
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 min-w-0 ${className}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] min-w-0">
        <span className="material-symbols-outlined text-[14px] flex-shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold text-[var(--color-text-primary)] truncate">
        {value}
      </div>
    </div>
  )
}

function DetailStat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: string
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-2 text-base font-semibold text-[var(--color-text-primary)] break-all">
        {value}
      </div>
    </div>
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
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
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
              icon="layers"
            />
            <DetailStat
              label={t('settings.agents.summary.model')}
              value={agent.modelDisplay || '—'}
              icon="psychology"
            />
            <DetailStat
              label={t('settings.agents.summary.tools')}
              value={String(agent.tools?.length ?? 0)}
              icon="build"
            />
            <DetailStat
              label={t('settings.agents.summary.status')}
              value={agent.isActive ? t('settings.agents.status.active') : t('settings.agents.status.available')}
              icon="bolt"
            />
          </div>
        </div>
      </section>

      {agent.tools && agent.tools.length > 0 && (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">
              build
            </span>
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
                <span className="material-symbols-outlined text-[32px] text-[var(--color-text-tertiary)] mb-2 block">
                  article
                </span>
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
      useUIStore.getState().setPendingSettingsTab('plugins')
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
      {isLoading && allAgents.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="text-center py-12 px-4">
          <span className="material-symbols-outlined text-[40px] text-[var(--color-error)] mb-3 block">error_outline</span>
          <p className="text-sm text-[var(--color-error)] mb-2">{error}</p>
          <button
            onClick={() => void fetchAgents(currentWorkDir)}
            className="text-xs text-[var(--color-text-accent)] hover:underline"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : allAgents.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <span className="material-symbols-outlined text-[40px] text-[var(--color-text-tertiary)] mb-3 block">smart_toy</span>
          <p className="text-sm text-[var(--color-text-secondary)] mb-1">{t('settings.agents.empty')}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{t('settings.agents.emptyHint')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 min-w-0">
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] overflow-hidden">
            <div className="grid gap-4 px-5 py-5 min-w-0 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] xl:items-end">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-tertiary)] mb-2">
                  {t('settings.agents.browserEyebrow')}
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="material-symbols-outlined text-[22px] text-[var(--color-brand)]">
                    smart_toy
                  </span>
                  <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                    {t('settings.agents.browserTitle')}
                  </h3>
                </div>
                <p className="text-sm leading-6 text-[var(--color-text-secondary)] max-w-3xl">
                  {t('settings.agents.description')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 min-w-0 sm:grid-cols-3">
                <SummaryCard
                  label={t('settings.agents.summary.totalAgents')}
                  value={String(allAgents.length)}
                  icon="smart_toy"
                />
                <SummaryCard
                  label={t('settings.agents.summary.activeAgents')}
                  value={String(activeAgents.length)}
                  icon="bolt"
                />
                <SummaryCard
                  label={t('settings.agents.summary.sources')}
                  value={String(sourceCount)}
                  icon="layers"
                  className="col-span-2 sm:col-span-1"
                />
              </div>
            </div>
          </section>

          <div className={`grid gap-4 ${sourceCount >= 2 ? 'xl:grid-cols-2' : ''}`}>
            {AGENT_SOURCE_ORDER.map((source) => {
              const group = groupedAgents[source]
              if (!group?.length) return null

              const sourceLabel = t(`settings.agents.source.${source}`)
              return (
                <section
                  key={source}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-w-0"
                >
                  <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${getAgentSourceAccentClass(source)}`}>
                          <span className="material-symbols-outlined text-[16px]">
                            {getAgentSourceIcon(source)}
                          </span>
                        </span>
                        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {sourceLabel}
                        </h4>
                        <span className="text-xs text-[var(--color-text-tertiary)]">
                          {group.length}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
                        {t('settings.agents.groupHint', {
                          source: sourceLabel,
                          count: String(group.length),
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col p-2">
                    {group.map((agent) => (
                      <button
                        key={`${agent.source}-${agent.agentType}`}
                        onClick={() => selectAgent(agent, 'agents')}
                        className="group rounded-xl border border-transparent px-3 py-3 text-left transition-all hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className="mt-0.5 flex-shrink-0 inline-flex items-center justify-center"
                            style={{ color: getAgentDotColor(agent.color) }}
                          >
                            <span className="material-symbols-outlined text-[18px]">smart_toy</span>
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-[var(--color-text-primary)] break-all">
                                {agent.agentType}
                              </span>
                              {agent.modelDisplay && (
                                <MetaPill>{agent.modelDisplay}</MetaPill>
                              )}
                              <MetaPill>{sourceLabel}</MetaPill>
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
                            </div>
                            <div className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)] break-words [&_.prose]:text-xs [&_.prose]:leading-5 [&_.prose]:text-[var(--color-text-secondary)]">
                              <MarkdownRenderer
                                content={agent.description || t('settings.agents.noDescription')}
                              />
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                              <span>
                                {agent.tools?.length
                                  ? t('settings.agents.toolCount', { count: String(agent.tools.length) })
                                  : t('settings.agents.noTools')}
                              </span>
                              {agent.baseDir && (
                                <span className="break-all">{agent.baseDir}</span>
                              )}
                            </div>
                          </div>
                          <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)] opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100">
                            chevron_right
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
