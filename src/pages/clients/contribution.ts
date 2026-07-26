import type { ClientDailyUsage } from '../../api/types'

export type CalendarCell = { date: string; day?: ClientDailyUsage }
export type CalendarWeek = { key: string; cells: CalendarCell[] }

function parseUTCDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatUTCDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

export function contributionLevel(value: number, maximum: number): number {
  if (!(value > 0) || !(maximum > 0)) return 0
  return Math.min(4, Math.max(1, Math.ceil((Math.log1p(value) / Math.log1p(maximum)) * 4)))
}

export function buildContributionWeeks(startDate: string, endDate: string, daily: ClientDailyUsage[]): CalendarWeek[] {
  if (!startDate || !endDate || startDate >= endDate) return []
  const byDate = new Map(daily.map((day) => [day.date || day.value, day]))
  const first = parseUTCDate(startDate)
  first.setUTCDate(first.getUTCDate() - first.getUTCDay())
  const last = parseUTCDate(endDate)
  last.setUTCDate(last.getUTCDate() - 1)
  last.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()))
  const weeks: CalendarWeek[] = []
  for (const weekStart = new Date(first); weekStart <= last; weekStart.setUTCDate(weekStart.getUTCDate() + 7)) {
    const cells = Array.from({ length: 7 }, (_, weekday) => {
      const date = new Date(weekStart)
      date.setUTCDate(date.getUTCDate() + weekday)
      const value = formatUTCDate(date)
      const supplied = byDate.get(value)
      const day = value >= startDate && value < endDate ? supplied || {
        value, date: value, status: 'unknown' as const, request_count: 0, success_count: 0, error_count: 0, fallback_count: 0,
        input_tokens: 0, output_tokens: 0, cached_input_read_tokens: 0, cached_input_write_tokens: 0,
        cache_read_tokens: 0, cache_create_tokens: 0, total_tokens: 0, cost_usd: 0,
        provider_usage_count: 0, estimated_usage_count: 0, last_seen_at: '',
      } : undefined
      return { date: value, day }
    })
    weeks.push({ key: formatUTCDate(weekStart), cells })
  }
  return weeks
}
