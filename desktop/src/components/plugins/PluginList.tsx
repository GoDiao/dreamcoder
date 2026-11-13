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
    return <div className="text-sm text-destructive py-4">{error}</div>
  }

  if (plugins.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-muted-foreground">
          {t('settings.plugins.empty')}
        </p>
        <p className="text-xs text-subtle-foreground mt-1">
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
        <p className="-mt-3 mb-4 text-xs text-subtle-foreground">
          {t('settings.plugins.lastReload', {
            enabled: String(lastReloadSummary.enabled),
            skills: String(lastReloadSummary.skills),
            errors: String(lastReloadSummary.errors),
          })}
        </p>
      )}

      {marketplaces.length > 0 && (
        <SettingsSection title={t('settings.plugins.marketplacesTitle')} count={marketplaces.length}>
          <p className="-mt-1.5 mb-1 text-xs leading-normal text-subtle-foreground">
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
          type="button"
          variant="ghost"
          size="row-flush"
          onClick={() => void fetchPluginDetail(plugin.id, cwd)}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="break-all text-sm font-medium text-foreground">
                {plugin.name}
              </span>
              <StatusPill plugin={plugin} />
              <ScopePill scope={plugin.scope} />
              {plugin.version && (
                <span className="rounded-sm bg-hover px-1.5 py-0.5 text-2xs text-muted-foreground">
                  v{plugin.version}
                </span>
              )}
            </span>
            <span className="mt-px block break-words text-xs leading-normal text-muted-foreground">
              {plugin.description || t('settings.plugins.noDescription')}
            </span>
            <span className="mt-px flex flex-wrap items-center gap-x-3 text-2xs text-subtle-foreground">
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
                <span className="text-destructive">
                  {t('settings.plugins.errorCount', { count: String(plugin.errors.length) })}
                </span>
              )}
            </span>
          </span>
          <ChevronRight size={14} aria-hidden="true" className="mr-1 flex-shrink-0 text-subtle-foreground" />
        </Button>
      ))}
    </SettingsSection>
  )
}

function StatusPill({ plugin }: { plugin: PluginSummary }) {
  const t = useTranslation()

  if (plugin.hasErrors) {
    return (
      <span className="rounded-sm bg-destructive/12 px-1.5 py-0.5 text-2xs text-destructive">
        {t('settings.plugins.status.attention')}
      </span>
    )
  }

  return (
    <span className={`rounded-sm px-1.5 py-0.5 text-2xs ${
      plugin.enabled
        ? 'bg-success-surface text-success'
        : 'bg-secondary text-subtle-foreground'
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
    <span className="rounded-sm bg-hover px-1.5 py-0.5 text-2xs text-muted-foreground">
      {t(`settings.plugins.scope.${scope}`)}
    </span>
  )
}
