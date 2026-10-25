import { useState, useEffect } from 'react'
import { getAppVersion } from '../../lib/shell'
import { ExternalLink } from 'lucide-react'
import { DreamCoderIcon } from '../shared/DreamCoderIcon'
import { Button } from '../shared/Button'
import { SettingsListRow, SettingsSection } from './SettingsSummary'
import { useTranslation } from '../../i18n'

const GITHUB_REPO = 'https://github.com/GoDiao/dreamcoder'
const GITHUB_ISSUES = `${GITHUB_REPO}/issues`
const GITHUB_RELEASES = `${GITHUB_REPO}/releases`
const AUTHOR_GITHUB = 'https://github.com/GoDiao'

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function AboutSettings() {
  const t = useTranslation()
  const [version, setVersion] = useState('')

  useEffect(() => {
    let cancelled = false

    getAppVersion()
      .then((value) => {
        if (!cancelled) setVersion(value)
      })
      .catch(() => {
        if (!cancelled) setVersion('0.1.0')
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="w-full min-w-0">
      <div className="mb-6 flex items-center gap-3">
        <DreamCoderIcon size={40} />
        <div className="min-w-0">
          <h2 className="text-ui-title font-semibold text-[var(--color-text-primary)]">DreamCoder</h2>
          <p className="text-xs leading-[1.7] text-[var(--color-text-secondary)]">
            {version ? `${t('settings.about.version')} ${version} · ` : ''}{t('settings.about.tagline')}
          </p>
        </div>
      </div>

      <SettingsListRow
        title={t('settings.about.repo')}
        description={<>GoDiao/dreamcoder · {t('settings.about.starHint')}</>}
        actions={<ExternalButton label="GitHub" onClick={() => openUrl(GITHUB_REPO)} />}
      />
      <SettingsListRow
        title={t('settings.about.changelog')}
        description={t('settings.about.changelogDesc')}
        actions={<ExternalButton label={t('settings.about.view')} onClick={() => openUrl(GITHUB_RELEASES)} />}
      />
      <SettingsListRow
        title={t('settings.about.author')}
        description="GoDiao"
        actions={<ExternalButton label="GitHub" onClick={() => openUrl(AUTHOR_GITHUB)} />}
      />
      <SettingsListRow
        title={t('settings.about.feedback')}
        description={t('settings.about.feedbackDesc')}
        actions={<ExternalButton label={t('settings.about.view')} onClick={() => openUrl(GITHUB_ISSUES)} />}
      />

      <SettingsSection title={t('settings.about.updates')}>
        <p className="border-l-2 border-[var(--color-border)] py-1.5 pl-3 text-xs leading-[1.7] text-[var(--color-text-secondary)]">
          {t('settings.about.updatesNotAvailable')}
        </p>
      </SettingsSection>
    </div>
  )
}

function ExternalButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="xs" variant="secondary" onClick={onClick} icon={<ExternalLink size={13} aria-hidden="true" />}>
      {label}
    </Button>
  )
}
