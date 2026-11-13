import { ArrowLeftIcon, BotIcon, ChevronRightIcon, CircleAlertIcon, NetworkIcon, SparklesIcon, ZapIcon } from 'lucide-react'
import { DetailStat, MetaPill } from '../settings/SettingsSummary'
import { LoadingBlock } from '../shared/LoadingBlock'
import { useMemo, useState, type ReactNode } from 'react'
import { usePluginStore } from '../../stores/pluginStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { Button } from '../shared/ui/button'
import { CardButton } from '../shared/CardButton'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { PluginCapabilityKey } from '../../types/plugin'
import { useSkillStore } from '../../stores/skillStore'
import { useAgentStore } from '../../stores/agentStore'
import { useMcpStore } from '../../stores/mcpStore'

const CAPABILITY_ORDER: PluginCapabilityKey[] = [
  'lspServers',
]

export function PluginDetail() {
  const {
    selectedPlugin,
    isDetailLoading,
    isApplying,
    clearSelection,
    enablePlugin,
    disablePlugin,
    updatePlugin,
    uninstallPlugin,
    reloadPlugins,
  } = usePluginStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const addToast = useUIStore((s) => s.addToast)
  const fetchSkillDetail = useSkillStore((s) => s.fetchSkillDetail)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const selectAgent = useAgentStore((s) => s.selectAgent)
  const fetchServers = useMcpStore((s) => s.fetchServers)
  const selectServer = useMcpStore((s) => s.selectServer)
  const t = useTranslation()
  const [actionKey, setActionKey] = useState<string | null>(null)
  const [showUninstallDialog, setShowUninstallDialog] = useState(false)

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  const otherCapabilityItems = useMemo(
    () =>
      CAPABILITY_ORDER.map((key) => ({
        key,
        items: selectedPlugin?.capabilities[key] ?? [],
      })),
    [selectedPlugin],
  )

  if (isDetailLoading) {
    return (
      <LoadingBlock />
    )
  }

  if (!selectedPlugin) return null

  const canMutate = selectedPlugin.scope !== 'managed' && selectedPlugin.scope !== 'builtin'
  const canNavigateSharedCapabilities = selectedPlugin.enabled

  const runAction = async (key: string, fn: () => Promise<string>) => {
    setActionKey(key)
    try {
      const message = await fn()
      addToast({ type: 'success', message })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionKey(null)
    }
  }

  const handleReload = async () => {
    setActionKey('reload')
    try {
      const summary = await reloadPlugins(currentWorkDir, activeSessionId || undefined)
      addToast({
        type: summary.errors > 0 ? 'warning' : 'success',
        message: t('settings.plugins.reloadToast', {
          enabled: String(summary.enabled),
          skills: String(summary.skills),
          errors: String(summary.errors),
        }),
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setActionKey(null)
    }
  }

  const openSettingsTab = (tab: 'skills' | 'agents' | 'mcp') => {
    useUIStore.getState().openSettings(tab)
  }

  const handleOpenSkill = async (skillName: string) => {
    if (!canNavigateSharedCapabilities) {
      addToast({
        type: 'warning',
        message: t('settings.plugins.sharedNavigationDisabled'),
      })
      return
    }
    openSettingsTab('skills')
    await fetchSkillDetail('plugin', skillName, currentWorkDir, 'plugins')

    const { selectedSkill, error } = useSkillStore.getState()
    if (!selectedSkill && error) {
      addToast({ type: 'error', message: error })
    }
  }

  const handleOpenAgent = async (agentType: string) => {
    if (!canNavigateSharedCapabilities) {
      addToast({
        type: 'warning',
        message: t('settings.plugins.sharedNavigationDisabled'),
      })
      return
    }
    openSettingsTab('agents')
    await fetchAgents(currentWorkDir)

    const state = useAgentStore.getState()
    const agent = state.allAgents.find((entry) => entry.agentType === agentType)
    if (!agent) {
      addToast({
        type: 'error',
        message: `Unable to locate agent: ${agentType}`,
      })
      return
    }

    selectAgent(agent, 'plugins')
  }

  const handleOpenMcpServer = async (serverName: string) => {
    if (!canNavigateSharedCapabilities) {
      addToast({
        type: 'warning',
        message: t('settings.plugins.sharedNavigationDisabled'),
      })
      return
    }
    openSettingsTab('mcp')
    await fetchServers(undefined, currentWorkDir)

    const state = useMcpStore.getState()
    const server = state.servers.find((entry) => entry.name === serverName)
    if (!server) {
      addToast({
        type: 'error',
        message: `Unable to locate MCP server: ${serverName}`,
      })
      return
    }

    selectServer(server)
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div>
        <Button type="button" variant="ghost-muted" size="sm" onClick={clearSelection}>
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          {t('settings.plugins.back')}
        </Button>
      </div>

      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.9fr)] lg:items-start">
          <div className="min-w-0">
            <div className="text-2xs font-semibold uppercase tracking-widest text-subtle-foreground mb-2">
              {t('settings.plugins.entryEyebrow')}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-xl font-semibold leading-tight text-foreground break-all">
                {selectedPlugin.name}
              </h3>
              <StatusPill enabled={selectedPlugin.enabled} hasErrors={selectedPlugin.hasErrors} />
              <MetaPill>{t(`settings.plugins.scope.${selectedPlugin.scope}`)}</MetaPill>
              <MetaPill>{selectedPlugin.marketplace}</MetaPill>
              {selectedPlugin.version && <MetaPill>v{selectedPlugin.version}</MetaPill>}
            </div>
            <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
              {selectedPlugin.description || t('settings.plugins.noDescription')}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-subtle-foreground">
              {selectedPlugin.authorName && (
                <span>{t('settings.plugins.author', { value: selectedPlugin.authorName })}</span>
              )}
              {selectedPlugin.projectPath && (
                <span>{t('settings.plugins.projectPath', { value: selectedPlugin.projectPath })}</span>
              )}
              {selectedPlugin.installPath && (
                <span>{t('settings.plugins.installPath', { value: selectedPlugin.installPath })}</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
            <DetailStat
              label={t('settings.plugins.summary.skills')}
              value={String(selectedPlugin.componentCounts.skills)}
              icon={SparklesIcon}
            />
            <DetailStat
              label={t('settings.plugins.summary.agents')}
              value={String(selectedPlugin.componentCounts.agents)}
              icon={BotIcon}
            />
            <DetailStat
              label={t('settings.plugins.summary.mcp')}
              value={String(selectedPlugin.componentCounts.mcpServers)}
              icon={NetworkIcon}
            />
            <DetailStat
              label={t('settings.plugins.summary.hooks')}
              value={String(selectedPlugin.componentCounts.hooks)}
              icon={ZapIcon}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-background px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {canMutate && (
            selectedPlugin.enabled ? (
              <Button
                variant="outline"
                size="sm"
                loading={isApplying && actionKey === 'disable'}
                onClick={() => void runAction('disable', () => disablePlugin(selectedPlugin.id, selectedPlugin.scope, currentWorkDir, activeSessionId || undefined))}
              >
                {t('settings.plugins.disable')}
              </Button>
            ) : (
              <Button
                size="sm"
                loading={isApplying && actionKey === 'enable'}
                onClick={() => void runAction('enable', () => enablePlugin(selectedPlugin.id, selectedPlugin.scope, currentWorkDir, activeSessionId || undefined))}
              >
                {t('settings.plugins.enable')}
              </Button>
            )
          )}

          {canMutate && (
            <Button
              variant="outline"
              size="sm"
              loading={isApplying && actionKey === 'update'}
              onClick={() => void runAction('update', () => updatePlugin(selectedPlugin.id, selectedPlugin.scope, currentWorkDir, activeSessionId || undefined))}
            >
              {t('settings.plugins.update')}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            loading={isApplying && actionKey === 'reload'}
            onClick={() => void handleReload()}
          >
            {t('settings.plugins.apply')}
          </Button>

          {canMutate && (
            <Button
              variant="destructive"
              size="sm"
              loading={isApplying && actionKey === 'uninstall'}
              onClick={() => {
                setShowUninstallDialog(true)
              }}
            >
              {t('settings.plugins.uninstall')}
            </Button>
          )}
        </div>

        {!canMutate && (
          <p className="mt-3 text-xs text-subtle-foreground">
            {selectedPlugin.scope === 'managed'
              ? t('settings.plugins.managedHint')
              : t('settings.plugins.builtinHint')}
          </p>
        )}

        <p className="mt-3 text-xs text-subtle-foreground">
          {t('settings.plugins.applyHint')}
        </p>
      </section>

      {selectedPlugin.errors.length > 0 && (
        <section className="rounded-2xl border border-destructive/20 bg-destructive/6 px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <CircleAlertIcon className="shrink-0 text-destructive" aria-hidden="true" size={18} />
            <h4 className="text-sm font-semibold text-foreground">
              {t('settings.plugins.errorsTitle')}
            </h4>
          </div>
          <div className="flex flex-col gap-2">
            {selectedPlugin.errors.map((error) => (
              <div
                key={error}
                className="rounded-xl border border-destructive/15 bg-background px-3 py-3 text-sm text-muted-foreground"
              >
                {error}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-card">
          <h4 className="text-sm font-semibold text-foreground">
            {t('settings.plugins.capabilitiesTitle')}
          </h4>
          <p className="text-xs text-subtle-foreground mt-1">
            {t('settings.plugins.capabilitiesHint')}
          </p>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <CapabilityPreviewSection
            title={t('settings.plugins.capabilityLabel.skills')}
            count={selectedPlugin.skillEntries.length}
            emptyLabel={t('settings.plugins.capabilityEmpty')}
            hint={!canNavigateSharedCapabilities ? t('settings.plugins.sharedNavigationDisabled') : undefined}
          >
            {selectedPlugin.skillEntries.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {selectedPlugin.skillEntries.map((skill) => (
                  <SkillPreviewCard
                    key={skill.name}
                    name={skill.displayName || skill.name}
                    rawName={skill.displayName ? skill.name : undefined}
                    description={skill.description}
                    version={skill.version}
                    onClick={() => void handleOpenSkill(skill.name)}
                    disabled={!canNavigateSharedCapabilities}
                  />
                ))}
              </div>
            ) : null}
          </CapabilityPreviewSection>

          <CapabilityPreviewSection
            title={t('settings.plugins.capabilityLabel.mcpServers')}
            count={selectedPlugin.mcpServerEntries.length}
            emptyLabel={t('settings.plugins.capabilityEmpty')}
            hint={!canNavigateSharedCapabilities ? t('settings.plugins.sharedNavigationDisabled') : undefined}
          >
            {selectedPlugin.mcpServerEntries.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {selectedPlugin.mcpServerEntries.map((server) => (
                  <McpPreviewCard
                    key={server.name}
                    name={server.displayName || server.name}
                    transport={server.transport}
                    summary={server.summary}
                    onClick={() => void handleOpenMcpServer(server.name)}
                    disabled={!canNavigateSharedCapabilities}
                  />
                ))}
              </div>
            ) : null}
          </CapabilityPreviewSection>

          <CapabilityPreviewSection
            title={t('settings.plugins.capabilityLabel.commands')}
            count={selectedPlugin.commandEntries.length}
            emptyLabel={t('settings.plugins.capabilityEmpty')}
          >
            {selectedPlugin.commandEntries.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {selectedPlugin.commandEntries.map((command) => (
                  <CommandPreviewCard
                    key={command.name}
                    name={command.name}
                    description={command.description}
                  />
                ))}
              </div>
            ) : null}
          </CapabilityPreviewSection>

          <CapabilityPreviewSection
            title={t('settings.plugins.capabilityLabel.agents')}
            count={selectedPlugin.agentEntries.length}
            emptyLabel={t('settings.plugins.capabilityEmpty')}
            hint={!canNavigateSharedCapabilities ? t('settings.plugins.sharedNavigationDisabled') : undefined}
          >
            {selectedPlugin.agentEntries.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {selectedPlugin.agentEntries.map((agent) => (
                  <AgentPreviewCard
                    key={agent.name}
                    name={agent.displayName || agent.name}
                    description={agent.description}
                    onClick={() => void handleOpenAgent(agent.name)}
                    disabled={!canNavigateSharedCapabilities}
                  />
                ))}
              </div>
            ) : null}
          </CapabilityPreviewSection>

          <CapabilityPreviewSection
            title={t('settings.plugins.capabilityLabel.hooks')}
            count={selectedPlugin.hookEntries.length}
            emptyLabel={t('settings.plugins.capabilityEmpty')}
          >
            {selectedPlugin.hookEntries.length > 0 ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {selectedPlugin.hookEntries.map((hook, index) => (
                  <HookPreviewCard
                    key={`${hook.event}:${hook.matcher || 'all'}:${index}`}
                    event={hook.event}
                    matcher={hook.matcher}
                    actions={hook.actions}
                  />
                ))}
              </div>
            ) : null}
          </CapabilityPreviewSection>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {otherCapabilityItems.map(({ key, items }) => (
              <div
                key={key}
                className="rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-sm font-semibold text-foreground">
                    {t(`settings.plugins.capabilityLabel.${key}`)}
                  </div>
                  <span className="text-2xs text-subtle-foreground">
                    {items.length}
                  </span>
                </div>
                {items.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {items.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-border bg-background px-2.5 py-1 text-2xs text-muted-foreground break-all"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-subtle-foreground">
                    {t('settings.plugins.capabilityEmpty')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={showUninstallDialog}
        onClose={() => {
          if (isApplying && actionKey === 'uninstall') return
          setShowUninstallDialog(false)
        }}
        onConfirm={async () => {
          setShowUninstallDialog(false)
          await runAction('uninstall', () => uninstallPlugin(selectedPlugin.id, selectedPlugin.scope, false, currentWorkDir, activeSessionId || undefined))
        }}
        title={t('settings.plugins.uninstall')}
        body={t('settings.plugins.confirmUninstall', { name: selectedPlugin.name })}
        confirmLabel={t('settings.plugins.uninstall')}
        cancelLabel={t('common.cancel')}
        confirmVariant="destructive"
        loading={isApplying && actionKey === 'uninstall'}
      />
    </div>
  )
}

function CapabilityPreviewSection({
  title,
  count,
  children,
  emptyLabel,
  hint,
}: {
  title: string
  count: number
  children: ReactNode
  emptyLabel: string
  hint?: string
}) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-2xs text-subtle-foreground">{count}</div>
      </div>
      <div className="p-4">
        {hint && count > 0 && (
          <div className="mb-3 text-xs text-subtle-foreground">{hint}</div>
        )}
        {count > 0 ? children : (
          <div className="text-xs text-subtle-foreground">{emptyLabel}</div>
        )}
      </div>
    </section>
  )
}

function SkillPreviewCard({
  name,
  rawName,
  description,
  version,
  onClick,
  disabled,
}: {
  name: string
  rawName?: string
  description: string
  version?: string
  onClick: () => void
  disabled?: boolean
}) {
  const t = useTranslation()
  const slashName = rawName || name

  return (
    <CardButton
      onClick={onClick}
      disabled={disabled}
      className="group rounded-xl border border-border px-4 py-3 hover:border-ring disabled:hover:border-border disabled:hover:bg-background"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm font-semibold text-foreground break-all">{name}</span>
          {version && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-3xs font-medium text-subtle-foreground">
              v{version}
            </span>
          )}
          <span className="rounded-full border border-border px-2 py-0.5 text-3xs font-medium text-subtle-foreground">
            {t('settings.skills.slashCommand')}
          </span>
        </div>
        <ChevronRightIcon className="shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" size={18} />
      </div>
      <div className="mt-1 text-2xs text-subtle-foreground break-all">/{slashName}</div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground break-words">{description}</div>
    </CardButton>
  )
}

function CommandPreviewCard({
  name,
  description,
}: {
  name: string
  description: string
}) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <div className="text-sm font-semibold text-foreground break-all">/{name}</div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground break-words">{description}</div>
    </div>
  )
}

function AgentPreviewCard({
  name,
  description,
  onClick,
  disabled,
}: {
  name: string
  description: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <CardButton
      onClick={onClick}
      disabled={disabled}
      className="group rounded-xl border border-border px-4 py-3 hover:border-ring disabled:hover:border-border disabled:hover:bg-background"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground break-all">{name}</div>
          <div className="mt-2 text-xs leading-5 text-muted-foreground break-words">{description}</div>
        </div>
        <ChevronRightIcon className="shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" size={18} />
      </div>
    </CardButton>
  )
}

function McpPreviewCard({
  name,
  transport,
  summary,
  onClick,
  disabled,
}: {
  name: string
  transport: string
  summary: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <CardButton
      onClick={onClick}
      disabled={disabled}
      className="group rounded-xl border border-border px-4 py-3 hover:border-ring disabled:hover:border-border disabled:hover:bg-background"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground break-all">{name}</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-3xs font-medium uppercase tracking-widest text-subtle-foreground">
              {transport}
            </span>
          </div>
          <div className="mt-2 text-xs leading-5 text-muted-foreground break-all">{summary}</div>
        </div>
        <ChevronRightIcon className="shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" size={18} />
      </div>
    </CardButton>
  )
}

function HookPreviewCard({
  event,
  matcher,
  actions,
}: {
  event: string
  matcher?: string
  actions: string[]
}) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-foreground break-all">{event}</span>
        {matcher && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-3xs font-medium text-subtle-foreground break-all">
            {matcher}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((action) => (
          <span
            key={action}
            className="rounded-full border border-border bg-card px-2.5 py-1 text-2xs text-muted-foreground break-all"
          >
            {action}
          </span>
        ))}
      </div>
    </div>
  )
}

function StatusPill({
  enabled,
  hasErrors,
}: {
  enabled: boolean
  hasErrors: boolean
}) {
  const t = useTranslation()
  const classes = hasErrors
    ? 'bg-destructive/12 text-destructive'
    : enabled
      ? 'bg-success-surface text-success'
      : 'bg-secondary text-subtle-foreground'

  const label = hasErrors
    ? t('settings.plugins.status.attention')
    : enabled
      ? t('settings.plugins.status.enabled')
      : t('settings.plugins.status.disabled')

  return (
    <span className={`rounded-full px-2 py-0.5 text-3xs font-medium ${classes}`}>
      {label}
    </span>
  )
}
