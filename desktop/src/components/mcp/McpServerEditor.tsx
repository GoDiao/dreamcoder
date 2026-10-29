import { ArrowLeftIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useTranslation } from '../../i18n'
import type { McpWritableScope } from '../../types/mcp'
import { DirectoryPicker } from '../shared/DirectoryPicker'
import { Button } from '../shared/ui/button'
import { LabeledInput } from '../shared/LabeledInput'

const WRITABLE_SCOPES: McpWritableScope[] = ['local', 'project', 'user']

// Shared by the manual server editor and catalog review so a visual refresh
// changes their presentation in one place without changing either save path.
export function McpEditorLayout({
  title, description, notice, status, headerActions, onBack, backDisabled, children, actions,
}: {
  title: string
  description: string
  notice?: ReactNode
  status?: ReactNode
  headerActions?: ReactNode
  onBack: () => void
  backDisabled?: boolean
  children: ReactNode
  actions?: ReactNode
}) {
  const t = useTranslation()
  return (
    <div className="min-w-0">
      <Button variant="ghost" size="xs" onClick={onBack} disabled={backDisabled} className="mb-5 text-[var(--color-text-secondary)]">
        <ArrowLeftIcon aria-hidden="true" />
        {t('settings.mcp.form.back')}
      </Button>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-ui-title font-semibold text-[var(--color-text-primary)]">{title}</h2>
          <p className="mt-1.5 max-w-[60ch] text-xs leading-[1.7] text-[var(--color-text-secondary)]">{description}</p>
          {notice && <p className="mt-2 text-xs leading-[1.7] text-[var(--color-text-secondary)]">{notice}</p>}
          {status && <div className="mt-4 flex flex-wrap items-center gap-3">{status}</div>}
        </div>
        {headerActions && <div className="flex items-center gap-3">{headerActions}</div>}
      </div>
      <div className="space-y-4">{children}</div>
      {actions && <div className="mt-4 flex justify-end gap-2 pt-2">{actions}</div>}
    </div>
  )
}

export function McpEditorSection({ title, description, children }: {
  title?: string
  description?: string
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      {title && <h3 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>}
      {description && <p className="mb-3 text-xs leading-5 text-[var(--color-text-tertiary)]">{description}</p>}
      {children}
    </section>
  )
}

export function McpEditorFields({
  name, onNameChange, nameDisabled, nameError, autoFocus,
  scope, onScopeChange, scopeHint, projectPath, onProjectPathChange, currentWorkDir, projectWarning,
}: {
  name: string
  onNameChange: (value: string) => void
  nameDisabled?: boolean
  nameError?: string
  autoFocus?: boolean
  scope: McpWritableScope | null
  onScopeChange: (scope: McpWritableScope) => void
  scopeHint?: string
  projectPath: string
  onProjectPathChange: (path: string) => void
  currentWorkDir?: string
  projectWarning?: string
}) {
  const t = useTranslation()
  const scopeDescriptionId = useId()
  const targetPath = projectPath.trim()
  const needsProject = scope === 'local' || scope === 'project'
  const targetHint = scope === 'local'
    ? (targetPath
        ? t('settings.mcp.targetProject.localSelected', { path: targetPath })
        : currentWorkDir
          ? t('settings.mcp.targetProject.emptyWithCurrent', { path: currentWorkDir })
          : t('settings.mcp.targetProject.localEmpty'))
    : scope === 'project'
      ? (targetPath
          ? t('settings.mcp.targetProject.projectSelected', { path: targetPath })
          : currentWorkDir
            ? t('settings.mcp.targetProject.emptyWithCurrent', { path: currentWorkDir })
            : t('settings.mcp.targetProject.projectEmpty'))
      : t('settings.mcp.targetProject.globalHint')

  return (
    <>
      <McpEditorSection>
        <LabeledInput
          label={t('settings.mcp.form.name')}
          error={nameError}
          required
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t('settings.mcp.form.namePlaceholder')}
          disabled={nameDisabled}
          autoFocus={autoFocus}
          aria-invalid={!!nameError}
        />
      </McpEditorSection>
      <McpEditorSection title={t('settings.mcp.form.scope')} description={scopeHint}>
        <div className="grid gap-2 md:grid-cols-3">
          {WRITABLE_SCOPES.map((choice) => (
            <button
              key={choice}
              type="button"
              aria-label={t(`settings.mcp.scope.${choice}`)}
              aria-describedby={`${scopeDescriptionId}-${choice}`}
              aria-pressed={scope === choice}
              onClick={() => onScopeChange(choice)}
              className={`rounded-md border p-3 text-left transition-colors ${scope === choice
                ? 'border-[var(--color-border-focus)] bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`}
            >
              <span className="block text-sm font-semibold">{t(`settings.mcp.scope.${choice}`)}</span>
              <span id={`${scopeDescriptionId}-${choice}`} className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">{t(`settings.mcp.scopeDesc.${choice}`)}</span>
            </button>
          ))}
        </div>
      </McpEditorSection>
      {scope && (
        <McpEditorSection>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {needsProject ? t('settings.mcp.targetProject.title') : t('settings.mcp.targetProject.globalTitle')}
              </h3>
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{targetHint}</p>
            </div>
            {needsProject && <DirectoryPicker value={projectPath} onChange={onProjectPathChange} />}
          </div>
          {scope === 'project' && projectWarning && <p className="text-sm text-[var(--color-warning)]">{projectWarning}</p>}
        </McpEditorSection>
      )}
    </>
  )
}
