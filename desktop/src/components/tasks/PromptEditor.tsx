import { InputGroup, InputGroupTextarea } from '../shared/ui/input-group'
import { TriangleAlertIcon } from 'lucide-react'
import { PermissionModeSelector } from '../controls/PermissionModeSelector'
import { ModelSelector } from '../controls/ModelSelector'
import { DirectoryPicker } from '../shared/DirectoryPicker'
import { useTranslation } from '../../i18n'
import type { PermissionMode } from '../../types/settings'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string

  permissionMode: PermissionMode
  onPermissionModeChange: (mode: PermissionMode) => void

  modelId: string
  onModelChange: (modelId: string) => void
  providerId?: string | null
  onProviderIdChange: (providerId: string | null) => void

  folderPath: string
  onFolderPathChange: (path: string) => void

  useWorktree: boolean
  onUseWorktreeChange: (checked: boolean) => void
}

export function PromptEditor({
  value,
  onChange,
  placeholder,
  permissionMode,
  onPermissionModeChange,
  modelId,
  onModelChange,
  providerId,
  onProviderIdChange,
  folderPath,
  onFolderPathChange,
  useWorktree: _useWorktree,
  onUseWorktreeChange: _onUseWorktreeChange,
}: Props) {
  const t = useTranslation()
  return (
    <InputGroup className="items-stretch">
      <InputGroupTextarea
        aria-label={t('newTask.prompt')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="field-sizing-fixed w-full resize-y"
        style={{ minHeight: 120 }}
      />

      <div role="group" data-align="block-end" className="order-last flex w-full flex-col items-stretch gap-2 border-t border-border px-2.5 py-2">
        <div className="flex items-center justify-between">
          <PermissionModeSelector value={permissionMode} onChange={onPermissionModeChange} workDir={folderPath || undefined} />
          <ModelSelector
            runtimeSelection={modelId ? { providerId: providerId ?? null, modelId } : undefined}
            onRuntimeSelectionChange={(selection) => {
              onProviderIdChange(selection.providerId)
              onModelChange(selection.modelId)
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <DirectoryPicker value={folderPath} onChange={onFolderPathChange} />
        </div>

        {permissionMode === 'bypassPermissions' && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-destructive/8 text-3xs text-destructive">
            <TriangleAlertIcon aria-hidden="true" size={12} />
            {t('promptEditor.bypassWarning')}{folderPath ? ` ${t('promptEditor.within')} ${folderPath}` : ` ${t('promptEditor.selectFolder')}`}.
          </div>
        )}
      </div>
    </InputGroup>
  )
}
