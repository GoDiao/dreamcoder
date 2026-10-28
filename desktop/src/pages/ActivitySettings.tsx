import { LoaderCircleIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/shared/ui/tooltip'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader'
import { SettingsSummary } from '../components/settings/SettingsSummary'
import { activityStatsApi, type ActivityStatsResponse, type DailyActivity } from '../api/activityStats'
import { type Locale, useTranslation } from '../i18n'
import { useSettingsStore } from '../stores/settingsStore'

type HeatmapDay = {
  date: string
  sessionCount: number
  messageCount: number
  toolCallCount: number
  tokens: number
  level: number
}

type SummaryMetric = {
  label: string
  value: string
  detail?: string
}

const WEEK_COUNT = 52
const WEEKDAY_LABEL_KEYS = [
  'settings.activity.weekday.mon',
  'settings.activity.weekday.wed',
  'settings.activity.weekday.fri',
] as const
const HEAT_CELL_GAP = 3
const HEAT_LABEL_WIDTH = 38
const HEAT_CELL_MIN = 6
const HEAT_CELL_MAX = 22
const HEAT_COLORS = [
  'var(--color-activity-heat-0)',
  'var(--color-activity-heat-1)',
  'var(--color-activity-heat-2)',
  'var(--color-activity-heat-3)',
  'var(--color-activity-heat-4)',
]
const DATE_LOCALES: Record<Locale, string> = {
  en: 'en-US',
  zh: 'zh-CN',
}

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeek(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  next.setDate(next.getDate() - next.getDay())
  return next
}

function formatDateLabel(dateKey: string, locale: Locale) {
  return parseLocalDate(dateKey).toLocaleDateString(DATE_LOCALES[locale], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatMonthKey(dateKey: string) {
  const date = parseLocalDate(dateKey)
  return `${date.getFullYear()}.${`${date.getMonth() + 1}`.padStart(2, '0')}`
}

function formatDateRange(start: string, end: string) {
  return `${formatMonthKey(start)} - ${formatMonthKey(end)}`
}

function formatTokens(tokens: number) {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(tokens >= 10_000_000_000 ? 0 : 1)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return `${tokens}`
}

function formatSessionCount(value: number, t: ReturnType<typeof useTranslation>) {
  return t(value === 1 ? 'settings.activity.count.sessionOne' : 'settings.activity.count.sessionOther', { count: value })
}

function calculateHeatCellSize(width: number) {
  const available = width - HEAT_LABEL_WIDTH - (WEEK_COUNT - 1) * HEAT_CELL_GAP
  return Math.max(HEAT_CELL_MIN, Math.min(HEAT_CELL_MAX, Math.floor(available / WEEK_COUNT)))
}

function sumDailyUsage(days: HeatmapDay[]) {
  return days.reduce(
    (sum, day) => ({
      sessions: sum.sessions + day.sessionCount,
      tokens: sum.tokens + day.tokens,
    }),
    { sessions: 0, tokens: 0 },
  )
}

function getDailyTokenMap(stats: ActivityStatsResponse | null) {
  const map = new Map<string, number>()
  for (const day of stats?.dailyModelTokens ?? []) {
    const total = Object.values(day.tokensByModel).reduce((sum, tokens) => sum + tokens, 0)
    map.set(day.date, total)
  }
  return map
}

function getHeatLevel(day: DailyActivity | undefined, tokens: number, maxScore: number) {
  const sessionCount = day?.sessionCount ?? 0
  if (sessionCount === 0 && tokens === 0) return 0
  if (maxScore <= 0) return 1

  const score = sessionCount * 3 + Math.ceil(tokens / 50_000)
  const ratio = score / maxScore
  if (ratio >= 0.78) return 4
  if (ratio >= 0.5) return 3
  if (ratio >= 0.24) return 2
  return 1
}

function buildHeatmapDays(stats: ActivityStatsResponse | null) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const finalWeekStart = startOfWeek(today)
  const start = addDays(finalWeekStart, -(WEEK_COUNT - 1) * 7)
  const activityMap = new Map((stats?.dailyActivity ?? []).map((day) => [day.date, day]))
  const tokenMap = getDailyTokenMap(stats)

  const scores: number[] = []
  for (let cursor = new Date(start); cursor <= today; cursor = addDays(cursor, 1)) {
    const dateKey = localDateKey(cursor)
    const day = activityMap.get(dateKey)
    const tokens = tokenMap.get(dateKey) ?? 0
    scores.push((day?.sessionCount ?? 0) * 3 + Math.ceil(tokens / 50_000))
  }
  const maxScore = Math.max(...scores, 0)

  const days: HeatmapDay[] = []
  for (let cursor = new Date(start); cursor <= today; cursor = addDays(cursor, 1)) {
    const dateKey = localDateKey(cursor)
    const day = activityMap.get(dateKey)
    const tokens = tokenMap.get(dateKey) ?? 0
    days.push({
      date: dateKey,
      sessionCount: day?.sessionCount ?? 0,
      messageCount: day?.messageCount ?? 0,
      toolCallCount: day?.toolCallCount ?? 0,
      tokens,
      level: getHeatLevel(day, tokens, maxScore),
    })
  }

  return days
}

function buildMonthLabels(days: HeatmapDay[], locale: Locale) {
  if (days.length === 0) return []
  const labels: Array<{ week: number; label: string }> = []
  const firstDay = days[0]
  const lastDay = days[days.length - 1]
  if (!firstDay || !lastDay) return labels

  const firstDate = parseLocalDate(firstDay.date)
  const lastDate = parseLocalDate(lastDay.date)
  let previousMonth = -1

  for (let week = 0; week < WEEK_COUNT; week += 1) {
    const weekDate = addDays(firstDate, week * 7)
    if (weekDate > lastDate) break
    if (weekDate.getMonth() !== previousMonth) {
      labels.push({
        week,
        label: weekDate.toLocaleDateString(DATE_LOCALES[locale], { month: 'short' }),
      })
      previousMonth = weekDate.getMonth()
    }
  }

  return labels
}

export function ActivitySettings() {
  const t = useTranslation()
  const locale = useSettingsStore((state) => state.locale)
  const heatmapMeasureRef = useRef<HTMLDivElement | null>(null)
  const [stats, setStats] = useState<ActivityStatsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [heatCellSize, setHeatCellSize] = useState(10)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    activityStatsApi.getStats('all')
      .then((nextStats) => {
        if (cancelled) return
        setStats(nextStats)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (isLoading || error) return
    const element = heatmapMeasureRef.current
    if (!element) return

    const updateCellSize = () => {
      const nextSize = calculateHeatCellSize(element.clientWidth)
      setHeatCellSize((current) => (current === nextSize ? current : nextSize))
    }

    updateCellSize()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateCellSize)
      observer.observe(element)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateCellSize)
    return () => window.removeEventListener('resize', updateCellSize)
  }, [error, isLoading])

  const days = useMemo(() => buildHeatmapDays(stats), [stats])
  const monthLabels = useMemo(() => buildMonthLabels(days, locale), [days, locale])
  const today = days.length > 0 ? days[days.length - 1] : null
  const heatGridWidth = WEEK_COUNT * heatCellSize + (WEEK_COUNT - 1) * HEAT_CELL_GAP
  const heatGridHeight = 7 * heatCellSize + 6 * HEAT_CELL_GAP
  const heatmapWidth = HEAT_LABEL_WIDTH + heatGridWidth
  const dateRange = days.length > 0 && days[0] && today ? formatDateRange(days[0].date, today.date) : ''
  const yesterdayDate = today ? localDateKey(addDays(parseLocalDate(today.date), -1)) : null
  const yesterday = days.find((day) => day.date === yesterdayDate) ?? null
  const last30Usage = sumDailyUsage(days.slice(-30))

  const metrics: SummaryMetric[] = [
    {
      label: t('settings.activity.metric.today'),
      value: t('settings.activity.tokenCount', { count: formatTokens(today?.tokens ?? 0) }),
      detail: today ? formatSessionCount(today.sessionCount, t) : formatSessionCount(0, t),
    },
    {
      label: t('settings.activity.metric.yesterday'),
      value: t('settings.activity.tokenCount', { count: formatTokens(yesterday?.tokens ?? 0) }),
      detail: formatSessionCount(yesterday?.sessionCount ?? 0, t),
    },
    {
      label: t('settings.activity.metric.last30'),
      value: t('settings.activity.tokenCount', { count: formatTokens(last30Usage.tokens) }),
      detail: formatSessionCount(last30Usage.sessions, t),
    },
  ]

  return (
    <div className="w-full min-w-0">
      <SettingsPageHeader
        className="!mb-2"
        title={t('settings.activity.title')}
        description={
          <>
            {dateRange && <span className="block">{dateRange}</span>}
            <span className="block">{t('settings.activity.subtitleLoading')}</span>
          </>
        }
      />

      <SettingsSummary
        items={metrics.map((metric) => ({ label: metric.label, value: metric.value, hint: metric.detail }))}
      />

      <div className="min-w-0">
        {isLoading ? (
          <div className="flex min-h-[190px] items-center justify-center text-sm text-[var(--color-text-tertiary)]">
            <LoaderCircleIcon className="shrink-0 mr-2 animate-spin" aria-hidden="true" size={18} />
            {t('common.loading')}
          </div>
        ) : error ? (
          <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error)]">
            {error}
          </div>
        ) : (
          <>
            <div ref={heatmapMeasureRef} className="min-w-0 pb-2">
              <div className="relative" style={{ width: heatmapWidth, maxWidth: '100%' }}>
                <div
                  className="mb-4 grid h-5 text-[11px] leading-none text-[var(--color-text-tertiary)]"
                  style={{
                    marginLeft: HEAT_LABEL_WIDTH,
                    gridTemplateColumns: `repeat(${WEEK_COUNT}, ${heatCellSize}px)`,
                    columnGap: HEAT_CELL_GAP,
                  }}
                >
                  {monthLabels.map((month) => (
                    <div key={`${month.week}-${month.label}`} style={{ gridColumn: `${month.week + 1} / span 4` }}>
                      {month.label}
                    </div>
                  ))}
                </div>

                <div className="flex items-start" style={{ gap: HEAT_CELL_GAP }}>
                  <div
                    className="grid shrink-0 grid-rows-7 text-[11px] leading-none text-[var(--color-text-tertiary)]"
                    style={{ width: HEAT_LABEL_WIDTH, height: heatGridHeight, rowGap: HEAT_CELL_GAP }}
                  >
                    <div className="row-start-2 flex items-center">{t(WEEKDAY_LABEL_KEYS[0])}</div>
                    <div className="row-start-4 flex items-center">{t(WEEKDAY_LABEL_KEYS[1])}</div>
                    <div className="row-start-6 flex items-center">{t(WEEKDAY_LABEL_KEYS[2])}</div>
                  </div>

                  <div
                    role="grid"
                    aria-label={t('settings.activity.heatmapLabel')}
                    className="grid grid-flow-col"
                    style={{
                      gridTemplateRows: `repeat(7, ${heatCellSize}px)`,
                      gridAutoColumns: `${heatCellSize}px`,
                      columnGap: HEAT_CELL_GAP,
                      rowGap: HEAT_CELL_GAP,
                    }}
                  >
                    {days.map((day) => (
                      <Tooltip key={day.date} delayDuration={0}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            role="gridcell"
                            aria-label={`${formatDateLabel(day.date, locale)}: ${formatSessionCount(day.sessionCount, t)}, ${t('settings.activity.tokenCount', { count: formatTokens(day.tokens) })}`}
                            className="rounded-sm border border-[var(--color-activity-cell-border)] transition-[border-color,transform] hover:scale-110 hover:border-[var(--color-activity-cell-border-hover)] data-[state=instant-open]:border-[var(--color-activity-cell-border-active)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:ring-offset-2 focus:ring-offset-[var(--color-surface)]"
                            style={{ width: heatCellSize, height: heatCellSize, backgroundColor: HEAT_COLORS[day.level] }}
                          />
                        </TooltipTrigger>
                        <TooltipContent className="block min-w-[172px] border border-[var(--color-activity-tooltip-border)] bg-[var(--color-activity-tooltip-surface)] text-xs shadow-[var(--shadow-dropdown)]">
                          <div className="font-medium text-[var(--color-activity-tooltip-text)]">{formatDateLabel(day.date, locale)}</div>
                          <div className="mt-1 text-[var(--color-activity-tooltip-muted)]">{formatSessionCount(day.sessionCount, t)} · {t('settings.activity.tokenCount', { count: formatTokens(day.tokens) })}</div>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </div>

              </div>
            </div>

            <div className="mt-3 flex items-center justify-end gap-2 text-xs text-[var(--color-text-tertiary)] xl:mt-4">
              <span>{t('settings.activity.less')}</span>
              {HEAT_COLORS.map((color) => (
                <span
                  key={color}
                  aria-hidden="true"
                  className="rounded-[3px] border border-[var(--color-activity-cell-border)]"
                  style={{ width: heatCellSize, height: heatCellSize, backgroundColor: color }}
                />
              ))}
              <span>{t('settings.activity.more')}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
