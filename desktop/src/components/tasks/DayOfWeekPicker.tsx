import { ToggleGroup, ToggleGroupItem } from '../shared/ui/toggle-group'
import { useTranslation } from '../../i18n'

type Props = {
  selected: number[]
  onChange: (days: number[]) => void
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

const DAY_KEYS = [
  'newTask.daySun',
  'newTask.dayMon',
  'newTask.dayTue',
  'newTask.dayWed',
  'newTask.dayThu',
  'newTask.dayFri',
  'newTask.daySat',
] as const

export function DayOfWeekPicker({ selected, onChange }: Props) {
  const t = useTranslation()

  return (
    <ToggleGroup type="multiple" variant="outline" value={selected.map(String)} aria-label={t('newTask.specificDays')} onValueChange={(values) => {
      if (values.length > 0) onChange(values.map(Number))
    }}>
      {DAY_ORDER.map((day) => (
        <ToggleGroupItem key={day} value={String(day)} className="size-8 p-0">
          {t(DAY_KEYS[day]!)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
