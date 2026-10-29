import { useEffect, useMemo } from 'react'
import { LoadingBlock } from '../shared/LoadingBlock'
import { usePluginStore } from '../../stores/pluginStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { Button } from '../shared/ui/button'
import { ChevronRight, RefreshCw, RotateCw } from 'lucide-react'
import { SettingsListRow, SettingsSection, SettingsSummary } from '../settings/SettingsSummary'
import type { PluginSummary } from '../../types/plugin'

type PluginBucket = 'attention' | 'enabled' | 'disabled'

export function PluginList() {
  const {
    plugins,
    marketplaces,
    summary,
    lastReloadSummary,
    isLoading,
    isApplying,
    error,
    fetchPlugins,
    fetchPluginDetail,
    reloadPlugins,
  } = usePluginStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const addToast = useUIStore((s) => s.addToast)
  const t = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  useEffect(() => {
    void fetchPlugins(currentWorkDir)
  }, [fetchPlugins, currentWorkDir])

  const grouped = useMemo(() => {
    const buckets: Record<PluginBucket, PluginSummary[]> = {
      attention: [],
      enabled: [],
      disabled: [],
    }

    for (const plugin of plugins) {
      if (plugin.hasErrors) {
        buckets.attention.push(plugin)
      } else if (plugin.enabled) {
        buckets.enabled.push(plugin)
      } else {
        buckets.disabled.push(plugin)
      }
    }

    return buckets
  }, [plugins])

  const handleReload = async () => {
    try {
      const reloadSummary = await reloadPlugins(currentWorkDir, activeSessionId || undefined)
      addToast({
        type: reloadSummary.errors > 0 ? 'warning' : 'success',
        message: t('settings.plugins.reloadToast', {
          enabled: String(reloadSummary.enabled),
          skills: String(reloadSummary.skills),
          errors: String(reloadSummary.errors),
        }),
      })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (isLoading) {
    return (
      <LoadingBlock />
    )
  }

  if (error) {
    return <div className="text-sm text-[var(--color-error)] py-4">{error}</div>
  }

  if (plugins.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {t('settings.plugins.empty')}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
          {t('settings.plugins.emptyHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center justify-end gap-1.5">
        <Button
          variant="outline"
          size="xs"
          onClick={() => void fetchPlugins(currentWorkDir)}
        >
          <RefreshCw data-icon="inline-start" size={13} aria-hidden="true" />
          {t('settings.plugins.refresh')}
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={handleReload}
          loading={isApplying}
        >
          <RotateCw data-icon="inline-start" size={13} aria-hidden="true" />
          {t('settings.plugins.apply')}
        </Button>
      </div>

      <SettingsSummary
        items={[
          { label: t('settings.plugins.summary.total'), value: summary?.total ?? plugins.length },
          { label: t('settings.plugins.summary.enabled'), value: summary?.enabled ?? plugins.filter((plugin) => plugin.enabled).length },
          { label: t('settings.plugins.summary.attention'), value: grouped.attention.length },
          { label: t('settings.plugins.summary.marketplaces'), value: summary?.marketplaceCount ?? marketplaces.length },
        ]}
      />

      {lastReloadSummary && (
        <p className="-mt-3 mb-4 text-xs text-[var(--color-text-tertiary)]">
          {t('settings.plugins.lastReload', {
            enabled: String(lastReloadSummary.enabled),
            skills: String(lastReloadSummary.skills),
            errors: String(lastReloadSummary.errors),
          })}
        </p>
      )}

      {marketplaces.length > 0 && (
        <SettingsSection title={t('settings.plugins.marketplacesTitle')} count={marketplaces.length}>
          <p className="-mt-1.5 mb-1 text-xs leading-[1.5] text-[var(--color-text-tertiary)]">
            {t('settings.plugins.marketplacesHint')}
          </p>
          {marketplaces.map((marketplace) => (
            <SettingsListRow
              key={marketplace.name}
              title={marketplace.name}
              description={[
                marketplace.source,
                t('settings.plugins.marketplaceInstalledCount', { count: String(marketplace.installedCount) }),
                marketplace.autoUpdate
                  ? t('settings.plugins.marketplaceAutoUpdateOn')
                  : t('settings.plugins.marketplaceAutoUpdateOff'),
                marketplace.lastUpdated
                  ? t('settings.plugins.marketplaceUpdatedAt', { value: new Date(marketplace.lastUpdated).toLocaleString() })
                  : null,
              ].filter(Boolean).join(' · ')}
            />
          ))}
        </SettingsSection>
      )}

      {renderGroup('attention', grouped.attention, fetchPluginDetail, currentWorkDir, t)}
      {renderGroup('enabled', grouped.enabled, fetchPluginDetail, currentWorkDir, t)}
      {renderGroup('disabled', grouped.disabled, fetchPluginDetail, currentWorkDir, t)}
    </div>
  )
}

function renderGroup(
  bucket: PluginBucket,
  items: PluginSummary[],
  fetchPluginDetail: (id: string, cwd?: string) => Promise<void>,
  cwd: string | undefined,
  t: ReturnType<typeof useTranslation>,
) {
  if (items.length === 0) return null

  const titleKey =
    bucket === 'attention'
      ? 'settings.plugins.group.attention'
      : bucket === 'enabled'
        ? 'settings.plugins.group.enabled'
        : 'settings.plugins.group.disabled'

  return (
    <SettingsSection key={bucket} title={t(titleKey)} count={items.length}>
      {items.map((plugin) => (
        <Button
          key={plugin.id}
          variant="ghost"
          size="row"
          onClick={() => void fetchPluginDetail(plugin.id, cwd)}
          className="gap-3 rounded-none border-0 border-b border-[var(--color-border-separator)] px-0 py-2.5"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="break-all text-[13px] font-medium text-[var(--color-text-primary)]">
                {plugin.name}
              </span>
              <StatusPill plugin={plugin} />
              <ScopePill scope={plugin.scope} />
              {plugin.version && (
                <span className="rounded-[4px] bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                  v{plugin.version}
                </span>
              )}
            </span>
            <span className="mt-px block break-words text-xs leading-[1.5] text-[var(--color-text-secondary)]">
              {plugin.description || t('settings.plugins.noDescription')}
            </span>
            <span className="mt-px flex flex-wrap items-center gap-x-3 text-[11px] text-[var(--color-text-tertiary)]">
              <span>{plugin.marketplace}</span>
              {plugin.componentCounts.skills > 0 && (
                <span>{t('settings.plugins.capability.skills', { count: String(plugin.componentCounts.skills) })}</span>
              )}
              {plugin.componentCounts.agents > 0 && (
                <span>{t('settings.plugins.capability.agents', { count: String(plugin.componentCounts.agents) })}</span>
              )}
              {plugin.componentCounts.mcpServers > 0 && (
                <span>{t('settings.plugins.capability.mcpServers', { count: String(plugin.componentCounts.mcpServers) })}</span>
              )}
              {plugin.errors.length > 0 && (
                <span className="text-[var(--color-error)]">
                  {t('settings.plugins.errorCount', { count: String(plugin.errors.length) })}
                </span>
              )}
            </span>
          </span>
          <ChevronRight size={14} aria-hidden="true" className="mr-1 flex-shrink-0 text-[var(--color-text-tertiary)]" />
        </Button>
      ))}
    </SettingsSection>
  )
}

function StatusPill({ plugin }: { plugin: PluginSummary }) {
  const t = useTranslation()

  if (plugin.hasErrors) {
    return (
      <span className="rounded-[4px] bg-[var(--color-error)]/12 px-1.5 py-0.5 text-[11px] text-[var(--color-error)]">
        {t('settings.plugins.status.attention')}
      </span>
    )
  }

  return (
    <span className={`rounded-[4px] px-1.5 py-0.5 text-[11px] ${
      plugin.enabled
        ? 'bg-[var(--color-success-container)] text-[var(--color-success)]'
        : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]'
    }`}>
      {plugin.enabled
        ? t('settings.plugins.status.enabled')
        : t('settings.plugins.status.disabled')}
    </span>
  )
}

function ScopePill({ scope }: { scope: PluginSummary['scope'] }) {
  const t = useTranslation()
  return (
    <span className="rounded-[4px] bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
      {t(`settings.plugins.scope.${scope}`)}
    </span>
  )
}
