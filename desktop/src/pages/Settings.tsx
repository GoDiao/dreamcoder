import { useState, useEffect, useMemo } from 'react'
import {
  Bot,
  Brain,
  ChartNoAxesColumn,
  Check,
  FilePenLine,
  Info,
  Monitor,
  Network,
  NotebookPen,
  Plug,
  Puzzle,
  ScrollText,
  SettingsIcon,
  ShieldCheck,
  Smartphone,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation, type TranslationKey } from '../i18n'
import { useSettingsStore } from '../stores/settingsStore'
import { computerUseApi } from '../api/computerUse'
import type { DefaultPermissionMode } from '../types/settings'
import { usePluginStore } from '../stores/pluginStore'
import { PluginList } from '../components/plugins/PluginList'
import { PluginDetail } from '../components/plugins/PluginDetail'
import { ComputerUseSettings } from './ComputerUseSettings'
import { H5AccessSettings } from '../components/settings/H5AccessSettings'
import { McpSettings } from './McpSettings'
import { DiagnosticsSettings } from './DiagnosticsSettings'
import { ActivitySettings } from './ActivitySettings'
import { MemorySettings } from './MemorySettings'
import { useUIStore, type SettingsTab } from '../stores/uiStore'
import { GeneralSettings } from '../components/settings/GeneralSettings'
import { ProviderSettings } from '../components/settings/ProviderSettings'
import { AgentsSettings } from '../components/settings/AgentsSettings'
import { SkillSettings } from '../components/settings/SkillSettings'
import { AboutSettings } from '../components/settings/AboutSettings'
import { SearchField } from '../components/shared/SearchField'
import { moveRovingFocus } from '../lib/rovingFocus'

type SettingsNavGroup = {
  titleKey: TranslationKey | null
  items: Array<{ tab: SettingsTab; Icon: LucideIcon }>
}

const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    titleKey: 'settings.group.settings',
    items: [
      { tab: 'providers', Icon: Network },
      { tab: 'general', Icon: SettingsIcon },
      { tab: 'permissions', Icon: ShieldCheck },
      { tab: 'activity', Icon: ChartNoAxesColumn },
    ],
  },
  {
    titleKey: 'settings.group.local',
    items: [
      { tab: 'h5Access', Icon: Smartphone },
      { tab: 'computerUse', Icon: Monitor },
      { tab: 'diagnostics', Icon: Wrench },
    ],
  },
  {
    titleKey: 'settings.group.customize',
    items: [
      { tab: 'mcp', Icon: Plug },
      { tab: 'agents', Icon: Bot },
      { tab: 'skills', Icon: ScrollText },
      { tab: 'memory', Icon: Brain },
      { tab: 'plugins', Icon: Puzzle },
    ],
  },
  { titleKey: null, items: [{ tab: 'about', Icon: Info }] },
]

export function Settings() {
  const activeTab = useUIStore((s) => s.settingsTab)
  const setActiveTab = useUIStore((s) => s.setSettingsTab)
  const [navQuery, setNavQuery] = useState('')
  const [tabContentVisible, setTabContentVisible] = useState(false)
  const t = useTranslation()

  useEffect(() => {
    setTabContentVisible(false)
    const frame = window.requestAnimationFrame(() => setTabContentVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab])

  const query = navQuery.trim().toLowerCase()
  const visibleGroups = useMemo(
    () => SETTINGS_NAV_GROUPS
      .map((group) => ({
        ...group,
        items: group.items.filter(({ tab }) => !query || t(`settings.tab.${tab}` as const).toLowerCase().includes(query)),
      }))
      .filter((group) => group.items.length > 0),
    [query, t],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 bg-[var(--color-surface)] max-[700px]:flex-col">
      <nav
        aria-label={t('settings.navLabel')}
        className="flex w-[196px] flex-shrink-0 flex-col gap-px overflow-y-auto overscroll-contain border-r border-[var(--color-border)] bg-[var(--color-surface-sidebar)] px-2.5 py-3 max-[700px]:max-h-[150px] max-[700px]:w-auto max-[700px]:flex-row max-[700px]:flex-wrap max-[700px]:border-b max-[700px]:border-r-0"
      >
        <SearchField
          value={navQuery}
          onChange={setNavQuery}
          placeholder={t('settings.navSearch')}
          aria-label={t('settings.navSearch')}
          className="mb-1.5 h-[30px] flex-shrink-0 max-[700px]:hidden"
        />
        {visibleGroups.map((group, index) => (
          <div key={group.titleKey ?? `group-${index}`} className="contents">
            {group.titleKey ? (
              <span className="px-2.5 pb-1 pt-3 text-[11px] text-[var(--color-text-tertiary)] max-[700px]:hidden">
                {t(group.titleKey)}
              </span>
            ) : (
              <span aria-hidden="true" className="h-3 flex-shrink-0 max-[700px]:hidden" />
            )}
            {group.items.map(({ tab, Icon }) => (
              <NavButton
                key={tab}
                Icon={Icon}
                label={t(`settings.tab.${tab}` as const)}
                active={activeTab === tab}
                onClick={() => setActiveTab(tab)}
              />
            ))}
          </div>
        ))}
        {visibleGroups.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-[var(--color-text-tertiary)]">{t('settings.navNoResults')}</p>
        ) : null}
      </nav>

      <div
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pb-8 pl-9 pr-10 pt-[26px] max-[700px]:px-[18px] max-[700px]:py-5"
      >
        <div className={`max-w-[760px] motion-page-transition${tabContentVisible ? ' motion-page-transition--visible' : ''}`}>
          {activeTab === 'providers' && <ProviderSettings />}
          {activeTab === 'permissions' && <PermissionSettings />}
          {activeTab === 'activity' && <ActivitySettings />}
          {activeTab === 'general' && <GeneralSettings />}
          {activeTab === 'h5Access' && <H5AccessSettings />}
          {activeTab === 'mcp' && <McpSettings />}
          {activeTab === 'agents' && <AgentsSettings />}
          {activeTab === 'skills' && <SkillSettings />}
          {activeTab === 'memory' && <MemorySettings />}
          {activeTab === 'plugins' && <PluginSettings />}
          {activeTab === 'computerUse' && <ComputerUseSettings />}
          {activeTab === 'diagnostics' && <DiagnosticsSettings />}
          {activeTab === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  )
}

function NavButton({ Icon, label, active, onClick }: { Icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full flex-shrink-0 items-center gap-[9px] rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] max-[700px]:w-auto ${
        active
          ? 'bg-[var(--color-surface-selected)] font-medium text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <Icon
        size={15}
        strokeWidth={1.7}
        aria-hidden="true"
        className={`flex-shrink-0 ${active ? '' : 'text-[var(--color-text-secondary)]'}`}
      />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}

const PERMISSION_MODES: Array<{ mode: DefaultPermissionMode; Icon: LucideIcon; descKey: TranslationKey }> = [
  { mode: 'default', Icon: ShieldCheck, descKey: 'permMode.askPermDesc' },
  { mode: 'acceptEdits', Icon: FilePenLine, descKey: 'permMode.autoAcceptDesc' },
  { mode: 'plan', Icon: NotebookPen, descKey: 'permMode.planModeDesc' },
  { mode: 'bypassPermissions', Icon: Zap, descKey: 'permMode.bypassDesc' },
]

function PermissionSettings() {
  const { permissionMode, setPermissionMode } = useSettingsStore()
  const t = useTranslation()
  const [computerUseEnabled, setComputerUseEnabled] = useState(false)

  // Bypass mode also skips the per-call confirmation of Computer Use actions.
  useEffect(() => {
    let cancelled = false
    computerUseApi.getConfig()
      .then(config => { if (!cancelled) setComputerUseEnabled(config.enabled) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <div>
      <h2 className="mb-1.5 text-ui-title font-semibold text-[var(--color-text-primary)]">{t('settings.permissions.title')}</h2>
      <p className="mb-6 max-w-[60ch] text-xs leading-[1.7] text-[var(--color-text-secondary)]">{t('settings.permissions.description')}</p>

      <div
        role="radiogroup"
        aria-label={t('settings.permissions.title')}
        className="flex flex-col"
        onKeyDown={(event) => {
          const mode = moveRovingFocus(event, '[role="radio"]')?.dataset.value as DefaultPermissionMode | undefined
          if (mode && mode !== permissionMode) setPermissionMode(mode)
        }}
      >
        {PERMISSION_MODES.map(({ mode, Icon, descKey }, index) => {
          const isSelected = permissionMode === mode
          const tabbable = isSelected || (index === 0 && !PERMISSION_MODES.some((entry) => entry.mode === permissionMode))
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={tabbable ? 0 : -1}
              data-value={mode}
              onClick={() => setPermissionMode(mode)}
              className={`flex w-full items-center gap-3.5 border-b border-[var(--color-border-separator)] px-3 py-4 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
                isSelected
                  ? 'rounded-[8px] bg-[var(--color-surface-hover)]'
                  : 'hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <Icon size={16} strokeWidth={1.7} aria-hidden="true" className="flex-shrink-0 text-[var(--color-text-secondary)]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[var(--color-text-primary)]">{t(`permMode.label.${mode}` as const)}</span>
                <span className="mt-px block text-xs leading-[1.5] text-[var(--color-text-secondary)]">{t(descKey)}</span>
                {mode === 'bypassPermissions' && computerUseEnabled ? (
                  <span role="note" className="mt-1 block text-xs leading-[1.5] text-[var(--color-error)]">
                    {t('permMode.computerUseBypassWarning')}
                  </span>
                ) : null}
              </span>
              <span className="ml-auto flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--color-brand)]">
                {isSelected ? <Check size={16} strokeWidth={2} aria-hidden="true" /> : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PluginSettings() {
  const selectedPlugin = usePluginStore((s) => s.selectedPlugin)
  const t = useTranslation()

  if (selectedPlugin) {
    return (
      <div className="w-full min-w-0">
        <PluginDetail />
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
        {t('settings.plugins.title')}
      </h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-4">
        {t('settings.plugins.description')}
      </p>
      <PluginList />
    </div>
  )
}
