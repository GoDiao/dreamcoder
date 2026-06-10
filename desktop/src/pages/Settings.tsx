import { useState, useEffect, useRef, lazy, Suspense, type CSSProperties } from 'react'
import QRCode from 'qrcode'
import { Copy, Eye, EyeOff, PowerOff, QrCode, RotateCw } from 'lucide-react'
import { DreamCoderIcon } from '../components/shared/DreamCoderIcon'
import { useSettingsStore, UI_ZOOM_DEFAULT, UI_ZOOM_MIN, UI_ZOOM_MAX, UI_ZOOM_STEP } from '../stores/settingsStore'
import { useTranslation } from '../i18n'
import { Modal } from '../components/shared/Modal'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import { Dropdown } from '../components/shared/Dropdown'
import type { PermissionMode, EffortLevel, ThemeMode, UpdateProxyMode, NetworkProxyMode, WebSearchMode, AppMode } from '../types/settings'
import type { Locale } from '../i18n'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping, ApiFormat, ProviderAuthStrategy } from '../types/provider'
import type { ProviderPreset } from '../types/providerPreset'
import { usePluginStore } from '../stores/pluginStore'
import { useUIStore, type SettingsTab } from '../stores/uiStore'
import { ProxyConfigForm } from '../components/settings/ProxyConfigForm'
import { ProviderFormModal } from '../components/settings/ProviderFormModal'
import {
  getDesktopNotificationPermission,
  notifyDesktop,
  openDesktopNotificationSettings,
  requestDesktopNotificationPermission,
  type DesktopNotificationPermission,
} from '../lib/desktopNotifications'
import {
  API_KEY_JSON_PLACEHOLDER,
  maskSettingsJsonSecrets,
  restoreSettingsJsonSecrets,
  stripProviderSettingsJsonEnv,
} from '../lib/providerSettingsJson'
import { copyTextToClipboard } from '../components/chat/clipboard'

// ─── v2 Batch A: lazy-load all settings tab content ────────────────────
// Each tab is its own chunk. Opening Settings no longer eagerly pulls in
// shiki/qrcode/mermaid/computer-use code paths that the user may never visit.
const AdapterSettings        = lazy(() => import('./AdapterSettings').then(m => ({ default: m.AdapterSettings })))
const PluginList             = lazy(() => import('../components/plugins/PluginList').then(m => ({ default: m.PluginList })))
const PluginDetail           = lazy(() => import('../components/plugins/PluginDetail').then(m => ({ default: m.PluginDetail })))
const ComputerUseSettings    = lazy(() => import('./ComputerUseSettings').then(m => ({ default: m.ComputerUseSettings })))
const H5AccessSettings       = lazy(() => import('../components/settings/H5AccessSettings').then(m => ({ default: m.H5AccessSettings })))
const McpSettings            = lazy(() => import('./McpSettings').then(m => ({ default: m.McpSettings })))
const TerminalSettings       = lazy(() => import('./TerminalSettings').then(m => ({ default: m.TerminalSettings })))
const DiagnosticsSettings    = lazy(() => import('./DiagnosticsSettings').then(m => ({ default: m.DiagnosticsSettings })))
const ActivitySettings       = lazy(() => import('./ActivitySettings').then(m => ({ default: m.ActivitySettings })))
const MemorySettings         = lazy(() => import('./MemorySettings').then(m => ({ default: m.MemorySettings })))
const GeneralSettings        = lazy(() => import('../components/settings/GeneralSettings').then(m => ({ default: m.GeneralSettings })))
const ProviderSettings       = lazy(() => import('../components/settings/ProviderSettings').then(m => ({ default: m.ProviderSettings })))
const AgentsSettings         = lazy(() => import('../components/settings/AgentsSettings').then(m => ({ default: m.AgentsSettings })))
const SkillSettings          = lazy(() => import('../components/settings/SkillSettings').then(m => ({ default: m.SkillSettings })))
const AboutSettings          = lazy(() => import('../components/settings/AboutSettings').then(m => ({ default: m.AboutSettings })))

const NETWORK_TIMEOUT_MIN_SECONDS = 5
const NETWORK_TIMEOUT_MAX_SECONDS = 600
const NETWORK_TIMEOUT_STEP_SECONDS = 30

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers')
  const pendingSettingsTab = useUIStore((s) => s.pendingSettingsTab)
  const t = useTranslation()

  useEffect(() => {
    if (!pendingSettingsTab) return
    setActiveTab(pendingSettingsTab)
    useUIStore.getState().setPendingSettingsTab(null)
  }, [pendingSettingsTab])

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)]">
      <div className="flex-1 flex overflow-hidden">
        {/* Tab navigation */}
        <div className="w-[180px] border-r border-[var(--color-border)] py-3 flex-shrink-0 flex flex-col">
          <div className="flex-1">
            <TabButton icon="dns" label={t('settings.tab.providers')} active={activeTab === 'providers'} onClick={() => setActiveTab('providers')} />
            <TabButton icon="shield" label={t('settings.tab.permissions')} active={activeTab === 'permissions'} onClick={() => setActiveTab('permissions')} />
            <TabButton icon="tune" label={t('settings.tab.general')} active={activeTab === 'general'} onClick={() => setActiveTab('general')} />
            {/* Phase 1: hidden tabs — H5 Access (Phase 4), Adapters (Phase 3), Computer Use (Phase 4), Agents, Skills, Memory, Plugins */}
            {/* <TabButton icon="qr_code_2" label={t('settings.tab.h5Access')} active={activeTab === 'h5Access'} onClick={() => setActiveTab('h5Access')} /> */}
            {/* <TabButton icon="chat" label={t('settings.tab.adapters')} active={activeTab === 'adapters'} onClick={() => setActiveTab('adapters')} /> */}
            <TabButton icon="terminal" label={t('settings.tab.terminal')} active={activeTab === 'terminal'} onClick={() => setActiveTab('terminal')} />
            <TabButton icon="dns" label={t('settings.tab.mcp')} active={activeTab === 'mcp'} onClick={() => setActiveTab('mcp')} />
            <TabButton icon="smart_toy" label={t('settings.tab.agents')} active={activeTab === 'agents'} onClick={() => setActiveTab('agents')} />
            <TabButton icon="auto_awesome" label={t('settings.tab.skills')} active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} />
            <TabButton icon="history_edu" label={t('settings.tab.memory')} active={activeTab === 'memory'} onClick={() => setActiveTab('memory')} />
            <TabButton icon="extension" label={t('settings.tab.plugins')} active={activeTab === 'plugins'} onClick={() => setActiveTab('plugins')} />
            <TabButton icon="mouse" label={t('settings.tab.computerUse')} active={activeTab === 'computerUse'} onClick={() => setActiveTab('computerUse')} />
            <TabButton icon="monitoring" label={t('settings.tab.activity')} active={activeTab === 'activity'} onClick={() => setActiveTab('activity')} />
            <TabButton icon="monitor_heart" label={t('settings.tab.diagnostics')} active={activeTab === 'diagnostics'} onClick={() => setActiveTab('diagnostics')} />
          </div>
          <div className="border-t border-[var(--color-border)]/40 pt-1">
            <TabButton icon="info" label={t('settings.tab.about')} active={activeTab === 'about'} onClick={() => setActiveTab('about')} />
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <Suspense fallback={<TabFallback />}>
            {activeTab === 'providers' && <ProviderSettings />}
            {activeTab === 'permissions' && <PermissionSettings />}
            {activeTab === 'activity' && <ActivitySettings />}
            {activeTab === 'general' && <GeneralSettings />}
            {activeTab === 'h5Access' && <H5AccessSettings />}
            {activeTab === 'adapters' && <AdapterSettings />}
            {activeTab === 'terminal' && <TerminalSettings showPreferences />}
            {activeTab === 'mcp' && <McpSettings />}
            {activeTab === 'agents' && <AgentsSettings />}
            {activeTab === 'skills' && <SkillSettings />}
            {activeTab === 'memory' && <MemorySettings />}
            {activeTab === 'plugins' && <PluginSettings />}
            {activeTab === 'computerUse' && <ComputerUseSettings />}
            {activeTab === 'diagnostics' && <DiagnosticsSettings />}
            {activeTab === 'about' && <AboutSettings />}
          </Suspense>
        </div>
      </div>
    </div>
  )
}

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-12 text-[var(--color-text-tertiary)]">
      <span className="material-symbols-outlined animate-spin text-[18px] mr-2">progress_activity</span>
      <span className="text-sm">Loading…</span>
    </div>
  )
}

function TabButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors border-l-2 ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] font-medium border-l-[var(--color-brand)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] border-l-transparent'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </button>
  )
}

// ─── Permission Settings ──────────────────────────────────────

function PermissionSettings() {
  const { permissionMode, setPermissionMode } = useSettingsStore()
  const t = useTranslation()

  const MODES: Array<{ mode: PermissionMode; icon: string; label: string; desc: string }> = [
    { mode: 'default', icon: 'verified_user', label: t('settings.permissions.default'), desc: t('settings.permissions.defaultDesc') },
    { mode: 'acceptEdits', icon: 'edit_note', label: t('settings.permissions.acceptEdits'), desc: t('settings.permissions.acceptEditsDesc') },
    { mode: 'plan', icon: 'architecture', label: t('settings.permissions.plan'), desc: t('settings.permissions.planDesc') },
    { mode: 'bypassPermissions', icon: 'bolt', label: t('settings.permissions.bypass'), desc: t('settings.permissions.bypassDesc') },
  ]

  return (
    <div className="max-w-xl">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.permissions.title')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-4">{t('settings.permissions.description')}</p>

      <div className="flex flex-col gap-2">
        {MODES.map(({ mode, icon, label, desc }) => {
          const isSelected = permissionMode === mode
          return (
            <button
              key={mode}
              onClick={() => setPermissionMode(mode)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                isSelected
                  ? 'border-[var(--color-brand)] bg-[var(--color-surface-container)] shadow-[var(--shadow-focus-ring)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-[var(--color-text-secondary)]">{icon}</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</div>
                <div className="text-xs text-[var(--color-text-tertiary)]">{desc}</div>
              </div>
              {isSelected && (
                <span className="material-symbols-outlined text-[18px] text-[var(--color-brand)]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
              )}
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
