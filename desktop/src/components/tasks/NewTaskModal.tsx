import { ClockIcon, InfoIcon } from 'lucide-react'
import { useState } from 'react'
import { useTaskStore } from '../../stores/taskStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { Modal } from '../shared/Modal'
import { FormSelect } from '../shared/FormSelect'
import { Checkbox } from '../shared/ui/checkbox'
import { Field, FieldLabel } from '../shared/ui/field'
import { Input } from '../shared/ui/input'
import { LabeledInput } from '../shared/LabeledInput'
import { Button } from '../shared/ui/button'
import { PromptEditor } from './PromptEditor'
import { DayOfWeekPicker } from './DayOfWeekPicker'
import { useTranslation } from '../../i18n'
import { describeCron, isValidCron, parseCron, type FrequencyKey } from '../../lib/cronDescribe'
import type { PermissionMode } from '../../types/settings'
import type { CronTask } from '../../types/task'

type Props = {
  open: boolean
  onClose: () => void
  editTask?: CronTask
}

const MINUTE_INTERVALS = [5, 10, 15, 20, 30]
const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12]
const MINUTE_OFFSETS = [0, 15, 30, 45]

function buildCron(
  freq: FrequencyKey,
  time: string,
  opts: {
    minuteInterval: number
    hourInterval: number
    minuteOffset: number
    selectedDays: number[]
    monthDay: number
    customCron: string
  },
): string {
  const [hours, minutes] = time.split(':').map(Number)
  switch (freq) {
    case 'everyNMinutes':
      return `*/${opts.minuteInterval} * * * *`
    case 'everyNHours':
      return `${opts.minuteOffset} */${opts.hourInterval} * * *`
    case 'daily':
      return `${minutes} ${hours} * * *`
    case 'weekdays':
      return `${minutes} ${hours} * * 1-5`
    case 'specificDays':
      return `${minutes} ${hours} * * ${[...opts.selectedDays].sort((a, b) => a - b).join(',')}`
    case 'monthly':
      return `${minutes} ${hours} ${opts.monthDay} * *`
    case 'customCron':
      return opts.customCron.trim()
  }
}

export function NewTaskModal({ open, onClose, editTask }: Props) {
  const t = useTranslation()
  const createTask = useTaskStore((state) => state.createTask)
  const updateTask = useTaskStore((state) => state.updateTask)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const defaultWorkDir = activeSession?.workDir || ''
  const isEdit = !!editTask
  const parsed = editTask ? parseCron(editTask.cron) : null

  const FREQUENCY_OPTIONS: Array<{ value: FrequencyKey; label: string }> = [
    { value: 'everyNMinutes', label: t('newTask.everyNMinutes') },
    { value: 'everyNHours',   label: t('newTask.everyNHours') },
    { value: 'daily',         label: t('newTask.daily') },
    { value: 'weekdays',      label: t('newTask.weekdays') },
    { value: 'specificDays',  label: t('newTask.specificDays') },
    { value: 'monthly',       label: t('newTask.monthly') },
    { value: 'customCron',    label: t('newTask.customCron') },
  ]

  const [name, setName] = useState(editTask?.name || '')
  const [description, setDescription] = useState(editTask?.description || '')
  const [prompt, setPrompt] = useState(editTask?.prompt || '')
  const [frequency, setFrequency] = useState<FrequencyKey>(parsed?.frequency || 'daily')
  const [time, setTime] = useState(parsed?.time || '09:00')
  const [model, setModel] = useState(editTask?.model || '')
  const [providerId, setProviderId] = useState<string | null | undefined>(editTask?.providerId)
  const defaultPermissionMode = useSettingsStore((s) => s.permissionMode)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    (editTask?.permissionMode as PermissionMode | undefined) ?? defaultPermissionMode,
  )
  const [folderPath, setFolderPath] = useState(editTask?.folderPath || defaultWorkDir)
  const [useWorktree, setUseWorktree] = useState(editTask?.useWorktree || false)
  const [notifyEnabled, setNotifyEnabled] = useState(
    !!editTask?.notification?.enabled && editTask.notification.channels.includes('desktop'),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [minuteInterval, setMinuteInterval] = useState(parsed?.minuteInterval || 15)
  const [hourInterval, setHourInterval] = useState(parsed?.hourInterval || 1)
  const [minuteOffset, setMinuteOffset] = useState(parsed?.minuteOffset || 0)
  const [selectedDays, setSelectedDays] = useState<number[]>(parsed?.selectedDays || [1])
  const [monthDay, setMonthDay] = useState(parsed?.monthDay || 1)
  const [customCron, setCustomCron] = useState(parsed?.customCron || '0 9 * * *')

  const showTime = ['daily', 'weekdays', 'specificDays', 'monthly'].includes(frequency)

  const cronValue = buildCron(frequency, time, {
    minuteInterval, hourInterval, minuteOffset, selectedDays, monthDay, customCron,
  })

  const canSubmit =
    name.trim() &&
    description.trim() &&
    prompt.trim() &&
    (frequency !== 'customCron' || isValidCron(customCron)) &&
    (frequency !== 'specificDays' || selectedDays.length > 0)

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        cron: cronValue,
        prompt: prompt.trim(),
        model: model || undefined,
        providerId,
        permissionMode,
        folderPath: folderPath.trim() || undefined,
        useWorktree: useWorktree || undefined,
        notification: notifyEnabled
          ? { enabled: true, channels: ['desktop' as const] }
          : undefined,
      }
      if (isEdit) {
        await updateTask(editTask!.id, payload)
      } else {
        await createTask({ ...payload, enabled: true, recurring: true })
      }
      onClose()
    } catch (err) {
      console.error(`Failed to ${isEdit ? 'update' : 'create'} task:`, err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('tasks.editTitle') : t('newTask.title')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {isEdit ? t('tasks.saveChanges') : t('newTask.create')}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-[var(--color-surface-container)] mb-5">
        <InfoIcon className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" size={18} />
        <span className="text-xs text-[var(--color-text-secondary)]">
          {t('newTask.localWarning')}
        </span>
      </div>

      <div className="flex flex-col gap-4">
        <LabeledInput
          label={t('newTask.name')}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('newTask.namePlaceholder')}
        />

        <LabeledInput
          label={t('newTask.description')}
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('newTask.descPlaceholder')}
        />

        <PromptEditor
          value={prompt}
          onChange={setPrompt}
          placeholder={t('newTask.promptPlaceholder')}
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          modelId={model}
          onModelChange={setModel}
          providerId={providerId}
          onProviderIdChange={setProviderId}
          folderPath={folderPath}
          onFolderPathChange={setFolderPath}
          useWorktree={useWorktree}
          onUseWorktreeChange={setUseWorktree}
        />

        <Field>
          <FieldLabel htmlFor="new-task-frequency">{t('newTask.frequency')}</FieldLabel>
          <FormSelect id="new-task-frequency" label={t('newTask.frequency')} value={frequency} onChange={setFrequency} options={FREQUENCY_OPTIONS} />
        </Field>

        {frequency === 'everyNMinutes' && (
          <FormSelect label={t('newTask.everyNMinutes')} value={String(minuteInterval)} onChange={(value) => setMinuteInterval(Number(value))} options={MINUTE_INTERVALS.map((n) => ({ value: String(n), label: t('newTask.intervalMinutes', { n }) }))} />
        )}

        {frequency === 'everyNHours' && (
          <div className="flex gap-2">
            <div className="flex-1">
              <FormSelect label={t('newTask.everyNHours')} value={String(hourInterval)} onChange={(value) => setHourInterval(Number(value))} options={HOUR_INTERVALS.map((n) => ({ value: String(n), label: t('newTask.intervalHours', { n }) }))} />
            </div>
            <div className="flex-1">
              <FormSelect label={t('newTask.minuteOffset')} value={String(minuteOffset)} onChange={(value) => setMinuteOffset(Number(value))} options={MINUTE_OFFSETS.map((m) => ({ value: String(m), label: t('newTask.atMinute', { m: m.toString().padStart(2, '0') }) }))} />
            </div>
          </div>
        )}

        {frequency === 'specificDays' && (
          <DayOfWeekPicker selected={selectedDays} onChange={setSelectedDays} />
        )}

        {frequency === 'monthly' && (
          <FormSelect label={t('newTask.monthDay')} value={String(monthDay)} onChange={(value) => setMonthDay(Number(value))} options={Array.from({ length: 28 }, (_, i) => i + 1).map((d) => ({ value: String(d), label: t('newTask.onMonthDay', { d }) }))} />
        )}

        {frequency === 'customCron' && (
          <div className="flex flex-col gap-1">
            <Input
              aria-label={t('newTask.customCron')}
              aria-invalid={!!customCron.trim() && !isValidCron(customCron)}
              type="text"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder={t('newTask.cronFormatHint')}
              className="font-mono"
            />
            <span className="text-xs text-[var(--color-text-tertiary)]">{t('newTask.cronFormatHint')}</span>
            {customCron.trim() && !isValidCron(customCron) && (
              <span className="text-xs text-[var(--color-error)]">{t('newTask.invalidCron')}</span>
            )}
          </div>
        )}

        {showTime && (
          <Input
            aria-label={t('newTask.time')}
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-auto"
            style={{ maxWidth: 120 }}
          />
        )}

        <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={notifyEnabled}
              onCheckedChange={(checked) => setNotifyEnabled(checked === true)}
            />
            <div>
              <span className="text-sm font-medium text-[var(--color-text-primary)]">{t('newTask.notifyOnComplete')}</span>
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('newTask.notifyHint')}</p>
            </div>
          </label>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--color-surface-container)] text-xs text-[var(--color-text-secondary)]">
          <ClockIcon aria-hidden="true" size={16} />
          <span>
            {frequency === 'customCron' && customCron.trim() && !isValidCron(customCron)
              ? t('newTask.invalidCron')
              : describeCron(cronValue, t)
            }
          </span>
        </div>

        <p className="text-xs text-[var(--color-text-tertiary)]">
          {t('newTask.delayNote')}
        </p>
      </div>
    </Modal>
  )
}
