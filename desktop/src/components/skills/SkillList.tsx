import { useEffect, useMemo, type ReactNode } from 'react'
import { Button } from '../shared/ui/button'
import { LoadingBlock } from '../shared/LoadingBlock'
import { ChevronRight, FileText, Plus } from 'lucide-react'
import { useSkillStore } from '../../stores/skillStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { SearchField } from '../shared/SearchField'
import type { SkillMeta, SkillSource } from '../../types/skill'

const SOURCE_ORDER: SkillSource[] = ['user', 'claudeCode', 'project', 'plugin', 'mcp', 'bundled']

type SkillListProps = {
  /** Search text, kept by the parent so it survives opening a skill's detail. */
  query: string
  onQueryChange: (query: string) => void
}

export function SkillList({ query, onQueryChange }: SkillListProps) {
  const { skills, isLoading, error, fetchSkills, fetchSkillDetail } =
    useSkillStore()
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined
  const projectName = currentWorkDir?.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || null
  const normalizedSearchQuery = query.trim().toLocaleLowerCase()

  useEffect(() => {
    fetchSkills(currentWorkDir)
  }, [fetchSkills, currentWorkDir])

  const filteredSkills = useMemo(() => {
    if (!normalizedSearchQuery) return skills

    return skills.filter((skill) => {
      const fields = [
        skill.name,
        skill.displayName,
        skill.description,
        skill.source,
        t(`settings.skills.source.${skill.source}`),
        skill.version,
        skill.pluginName,
      ]

      return fields.some((field) =>
        field?.toLocaleLowerCase().includes(normalizedSearchQuery),
      )
    })
  }, [skills, normalizedSearchQuery, t])

  const grouped = useMemo(() => {
    const result: Partial<Record<SkillSource, SkillMeta[]>> = {}
    for (const skill of filteredSkills) {
      const src = skill.source as SkillSource
      ;(result[src] ??= []).push(skill)
    }
    return result
  }, [filteredSkills])

  const header = (
    <div className="mb-5 flex flex-wrap items-center gap-2.5">
      <div className="mr-auto flex items-baseline gap-2.5">
        <h2 className="text-ui-title font-semibold text-[var(--color-text-primary)]">{t('settings.skills.pageTitle')}</h2>
        <span className="text-xs text-[var(--color-text-secondary)]">
          {t('settings.skills.installedCount', { count: String(skills.length) })}
        </span>
      </div>
      <SearchField
        value={query}
        onChange={onQueryChange}
        aria-label={t('settings.skills.searchLabel')}
        placeholder={t('settings.skills.searchPlaceholder')}
        className="w-[230px] min-w-[140px] max-w-full max-[780px]:flex-1"
      />
      <SkillAddButton />
    </div>
  )

  if (isLoading) {
    return (
      <div className="min-w-0">
        {header}
        <LoadingBlock />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-w-0">
        {header}
        <div className="text-sm text-[var(--color-error)] py-4">{error}</div>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      {header}

      {skills.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-[13px] text-[var(--color-text-secondary)]">{t('settings.skills.empty')}</p>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{t('settings.skills.emptyHint')}</p>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-[13px] text-[var(--color-text-secondary)]">{t('settings.skills.noSearchResults')}</p>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{t('settings.skills.noSearchResultsHint')}</p>
        </div>
      ) : (
        SOURCE_ORDER.map((source) => {
          const group = grouped[source]
          if (!group?.length) return null
          const sourceLabel = t(`settings.skills.source.${source}`)

          return (
            <section key={source} aria-label={sourceLabel} className="mb-[22px] last:mb-0">
              <h3 className="mb-[5px] flex items-center gap-[9px] text-sm font-semibold text-[var(--color-text-primary)]">
                {t('settings.skills.groupTitle', { source: sourceLabel })}
                <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-[var(--color-surface-hover)] px-1.5 py-px text-[11px] font-normal text-[var(--color-text-secondary)]">
                  {group.length}
                </span>
              </h3>

              <div className="flex flex-col">
                {group.map((skill) => (
                  <button
                    key={`${skill.source}-${skill.name}`}
                    type="button"
                    onClick={() =>
                      skill.hasDirectory &&
                      fetchSkillDetail(skill.source, skill.name, currentWorkDir, 'skills')
                    }
                    disabled={!skill.hasDirectory}
                    className="skill-row group relative flex w-full min-w-0 items-center gap-[11px] rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)] focus-visible:outline-none active:bg-[var(--color-surface-hover)] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent after:pointer-events-none after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-[var(--color-border-separator)] after:content-[''] hover:after:opacity-0 focus-visible:after:opacity-0 active:after:opacity-0 [&:has(+.skill-row:hover)]:after:opacity-0 [&:has(+.skill-row:focus-visible)]:after:opacity-0"
                  >
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[7px] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                      <FileText size={17} strokeWidth={1.7} aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="flex min-w-0 items-center gap-[9px]">
                        <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                          {skill.displayName || skill.name}
                        </span>
                        {source === 'project' && projectName ? <SkillBadge>{projectName}</SkillBadge> : null}
                        {skill.version ? <SkillBadge>v{skill.version}</SkillBadge> : null}
                        {skill.userInvocable ? <SkillBadge>{t('settings.skills.slashCommand')}</SkillBadge> : null}
                      </span>
                      <span className="truncate text-xs leading-[1.5] text-[var(--color-text-secondary)]">
                        <span>{sourceLabel}</span>
                        {skill.pluginName ? <> · <span>{skill.pluginName}</span></> : null}
                        {skill.description ? <> · <span>{skill.description}</span></> : null}
                      </span>
                    </span>
                    <ChevronRight
                      size={14}
                      aria-hidden="true"
                      className="mr-1 flex-none text-[var(--color-text-tertiary)]"
                    />
                  </button>
                ))}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}

function SkillBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex flex-none items-center rounded-[4px] bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
      {children}
    </span>
  )
}

function SkillAddButton() {
  const t = useTranslation()
  return (
    <Button onClick={() => useUIStore.getState().openSettings('plugins')}>
      <Plus aria-hidden="true" />
      {t('settings.skills.addFromPlugins')}
    </Button>
  )
}
