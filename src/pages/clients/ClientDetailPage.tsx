import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Grid, Space, Tag, Typography } from '@arco-design/web-react'
import { IconLeft, IconRefresh } from '@arco-design/web-react/icon'
import { Link, useParams } from 'react-router-dom'
import { apiGet, buildQuery } from '../../api/client'
import { ApiError, errorMessage } from '../../api/errors'
import type { ClientBindingResource, ClientDailyUsage, ClientQuotaMetrics, ClientQuotaType, ClientQuotaWindowMetrics, ClientUsageResponse, ClientUsageStats } from '../../api/types'
import { buildContributionWeeks, contributionLevel } from './contribution'

const { Row, Col } = Grid
const shortWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const metricOptions = ['requests', 'tokens', 'cost', 'errors'] as const

type HeatMetric = (typeof metricOptions)[number]

function parseUTCDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatUTCDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

function shiftUTCDate(value: string, days: number): string {
  const date = parseUTCDate(value)
  date.setUTCDate(date.getUTCDate() + days)
  return formatUTCDate(date)
}

function formatNumber(value: unknown): string {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

function formatCost(value: unknown): string {
  return `$${Number(value || 0).toFixed(4)}`
}

function formatUSD(value: unknown): string {
  return `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(value || 0))}`
}

function formatLastSeen(value?: string): string {
  return value || 'Never'
}

function metricValue(day: ClientDailyUsage, metric: HeatMetric): number {
  if (metric === 'requests') return day.request_count
  if (metric === 'tokens') return day.total_tokens
  if (metric === 'cost') return day.cost_usd
  return day.error_count
}

function MetricCard({ label, value, detail, className = '' }: { label: string; value: string; detail?: string; className?: string }) {
  return <Card bordered={false} className={`metric-card dense-metric ${className}`.trim()}><span className="metric-label">{label}</span><strong>{value}</strong>{detail ? <Typography.Text type="secondary">{detail}</Typography.Text> : null}</Card>
}

function SummaryCards({ summary, activeDays }: { summary: ClientUsageStats; activeDays: number }) {
  const requests = summary.request_count
  const errors = summary.error_count
  const errorRate = requests ? (errors / requests) * 100 : 0
  return <Row gutter={[14, 14]}>
    <Col xs={24} sm={12} xl={4}><MetricCard label="Requests" value={formatNumber(requests)} className="metric-card-blue" /></Col>
    <Col xs={24} sm={12} xl={4}><MetricCard label="Tokens" value={formatNumber(summary.total_tokens)} className="metric-card-orange" /></Col>
    <Col xs={24} sm={12} xl={4}><MetricCard label="Cost" value={formatCost(summary.cost_usd)} className="metric-card-green" /></Col>
    <Col xs={24} sm={12} xl={4}><MetricCard label="Errors" value={formatNumber(errors)} detail={`${errorRate.toFixed(2)}% error rate`} className="metric-card-red" /></Col>
    <Col xs={24} sm={12} xl={4}><MetricCard label="Active days" value={formatNumber(activeDays)} className="metric-card-gray" /></Col>
    <Col xs={24} sm={12} xl={4}><MetricCard label="Last seen" value={formatLastSeen(summary.last_seen_at)} className="metric-card-gray" /></Col>
  </Row>
}

function CoverageNotice({ response }: { response: ClientUsageResponse }) {
  const coverage = response.coverage
  if (!coverage.known) return <Alert type="warning" title="Usage coverage is unknown" content="Days without recorded usage cannot be confirmed as zero and are shown with an unknown pattern." />
  const details = [`Tracking started ${coverage.tracking_started_at || 'at an unknown time'}`, `backend: ${coverage.backend || 'unknown'}`, coverage.aggregates_persisted ? 'daily aggregates persisted' : 'daily aggregates are not persisted']
  if (coverage.raw_retention_days > 0) details.push(`${coverage.raw_retention_days}-day raw retention`)
  return <Alert type="info" title="Usage coverage" content={details.join(' · ')} />
}

function quotaType(window: ClientQuotaWindowMetrics): ClientQuotaType {
  return window.type || 'requests'
}

function quotaMetric(window: ClientQuotaWindowMetrics) {
  const type = quotaType(window)
  if (type === 'tokens') return { used: formatNumber(window.used_tokens), remaining: formatNumber(window.remaining_tokens), limit: formatNumber(window.max_tokens), unit: 'tokens' }
  if (type === 'cost') return { used: formatUSD(window.used_cost_usd), remaining: formatUSD(window.remaining_cost_usd), limit: formatUSD(window.max_cost_usd), unit: 'USD' }
  return { used: formatNumber(window.used_requests ?? window.used), remaining: formatNumber(window.remaining_requests ?? window.remaining), limit: formatNumber(window.max_requests ?? window.limit), unit: 'requests' }
}

function QuotaSummary({ quota }: { quota?: ClientQuotaMetrics }) {
  if (!quota) return <Typography.Text type="secondary">No runtime quota state.</Typography.Text>
  if (!quota.enabled) return <Typography.Text type="secondary">Quota disabled.</Typography.Text>
  return <div className="client-detail-quota"><Tag color={quota.state === 'available' ? 'green' : 'orange'}>{quota.state}</Tag>{quota.windows.map((window) => { const metric = quotaMetric(window); return <div key={window.name}><strong>{window.name} <Tag>{quotaType(window)}</Tag></strong><span>{metric.used} used · {metric.remaining} remaining / {metric.limit} {metric.unit}</span><span>Duration: {window.duration || 'rolling'}</span>{window.reset_at ? <span>Resets {window.reset_at}</span> : null}{window.unpriced_count || window.warning ? <Alert type="warning" title="Unpriced usage" content={`${formatNumber(window.unpriced_count)} successful terminal ${window.unpriced_count === 1 ? 'request was' : 'requests were'} counted as $0.${window.warning ? ` ${window.warning}` : ''}`} /> : null}</div> })}<Typography.Text type="secondary">Requests are measured at entry. Tokens and Cost are measured at successful terminal completion and may overshoot with current or concurrent requests. Cost uses pricing; unpriced usage counts as $0 and is warned above.</Typography.Text></div>
}

function BindingsCard({ bindings }: { bindings: ClientBindingResource[] }) {
  return <Card bordered={false} className="panel-card client-detail-bindings" title={`Bindings (${bindings.length})`}>{bindings.length ? <div className="client-detail-binding-list">{bindings.map((binding) => <div key={binding.inbound}><div><strong>{binding.inbound}</strong><Space size={6} wrap><Tag color="arcoblue">{binding.inbound_protocol}</Tag><Tag>{binding.tag}</Tag></Space></div><Typography.Text type="secondary">{binding.inbound_path}</Typography.Text></div>)}</div> : <div className="client-empty-bindings"><Typography.Text type="secondary">This client is not bound to any inbound.</Typography.Text><Typography.Text type="secondary">Add a binding from the Clients page when it should accept traffic.</Typography.Text></div>}</Card>
}

function DayPopover({ day }: { day: ClientDailyUsage }) {
  return <div className="client-day-popover" role="tooltip" id={`usage-day-${day.date}`}>
    <strong>{day.date} UTC</strong><span>Status: {day.status}</span>
    <span>Requests: {formatNumber(day.request_count)}</span><span>Successes: {formatNumber(day.success_count)}</span><span>Errors: {formatNumber(day.error_count)}</span><span>Fallbacks: {formatNumber(day.fallback_count)}</span>
    <span>Input tokens: {formatNumber(day.input_tokens)}</span><span>Output tokens: {formatNumber(day.output_tokens)}</span><span>Cache read: {formatNumber(day.cache_read_tokens)}</span><span>Cache create: {formatNumber(day.cache_create_tokens)}</span><span>Total tokens: {formatNumber(day.total_tokens)}</span>
    <span>Cost: {formatCost(day.cost_usd)}</span><span>Last seen: {formatLastSeen(day.last_seen_at)}</span>
  </div>
}

function ContributionHeatmap({ response }: { response: ClientUsageResponse }) {
  const [metric, setMetric] = useState<HeatMetric>('requests')
  const [activeDate, setActiveDate] = useState<string>()
  const weeks = useMemo(() => buildContributionWeeks(response.start_date, response.end_date, response.daily), [response])
  const maximum = useMemo(() => Math.max(0, ...response.daily.map((day) => metricValue(day, metric))), [response.daily, metric])
  const monthLabels = weeks.map((week, index) => {
    const rangeCells = week.cells.filter((cell) => cell.date >= response.start_date && cell.date < response.end_date)
    const firstReal = rangeCells.find((cell) => cell.date.endsWith('-01')) || (index === 0 ? rangeCells[0] : undefined)
    if (!firstReal) return null
    const month = firstReal.date.slice(0, 7)
    return <span key={`${week.key}-${month}`} style={{ gridColumn: index + 1 }}>{parseUTCDate(firstReal.date).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}{firstReal.date.slice(5, 7) === '01' || index === 0 ? ` ${firstReal.date.slice(0, 4)}` : ''}</span>
  })
  return <Card bordered={false} className="panel-card client-heatmap-card" title="Contribution activity" extra={<fieldset className="heatmap-metrics" aria-label="Heatmap metric">{metricOptions.map((option) => <label key={option}><input type="radio" name="heatmap-metric" checked={metric === option} onChange={() => setMetric(option)} />{option[0].toUpperCase() + option.slice(1)}</label>)}</fieldset>}>
    <div className="heatmap-scroll">
      <div className="heatmap-layout">
        <div className="heatmap-month-spacer" />
        <div className="heatmap-months" style={{ gridTemplateColumns: `repeat(${weeks.length}, 14px)` }}>{monthLabels}</div>
        <div className="heatmap-weekdays">{shortWeekdays.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="heatmap-weeks" aria-label={`${response.start_date} through ${shiftUTCDate(response.end_date, -1)} contribution heatmap`}>
          {weeks.map((week, weekIndex) => <div className="heatmap-week" data-week={week.key} key={week.key}>{week.cells.map((cell, weekday) => {
            if (!cell.day) return <span className="heatmap-placeholder" aria-hidden="true" data-date={cell.date} key={cell.date} />
            const day = cell.day
            const value = metricValue(day, metric)
            const level = contributionLevel(value, maximum)
            const labelValue = metric === 'cost' ? formatCost(value) : formatNumber(value)
            const active = activeDate === day.date
            return <span className="heat-day-wrap" key={day.date} onMouseLeave={() => setActiveDate((current) => current === day.date ? undefined : current)}>
              <button type="button" className={`heatmap-day heatmap-level-${level} heatmap-status-${day.status}`} data-date={day.date} data-week-index={weekIndex} data-weekday={weekday} data-level={level} aria-label={`${day.date}, ${labelValue} ${metric}, ${day.status} coverage`} aria-describedby={active ? `usage-day-${day.date}` : undefined} onMouseEnter={() => setActiveDate(day.date)} onFocus={() => setActiveDate(day.date)} onBlur={() => setActiveDate(undefined)} />
              {active ? <DayPopover day={day} /> : null}
            </span>
          })}</div>)}
        </div>
      </div>
    </div>
    <div className="heatmap-legend"><span>Less</span>{[0, 1, 2, 3, 4].map((level) => <i className={`heatmap-level-${level}`} key={level} />)}<span>More</span><i className="heatmap-status-unknown" /><span>Unknown</span><i className="heatmap-status-partial" /><span>Current partial day</span></div>
  </Card>
}

function DailyTable({ daily }: { daily: ClientDailyUsage[] }) {
  const rows = [...daily].sort((a, b) => b.date.localeCompare(a.date))
  return <Card bordered={false} className="data-card panel-card" title="Daily records"><div className="client-daily-scroll"><table className="client-daily-table"><thead><tr><th>Date (UTC)</th><th>Status</th><th>Requests</th><th>Success</th><th>Errors</th><th>Fallback</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache create</th><th>Total tokens</th><th>Cost</th><th>Last seen</th></tr></thead><tbody>{rows.map((day) => <tr key={day.date}><td>{day.date}</td><td><Tag color={day.status === 'complete' ? 'green' : day.status === 'partial' ? 'orange' : 'gray'}>{day.status}</Tag></td><td>{formatNumber(day.request_count)}</td><td>{formatNumber(day.success_count)}</td><td>{formatNumber(day.error_count)}</td><td>{formatNumber(day.fallback_count)}</td><td>{formatNumber(day.input_tokens)}</td><td>{formatNumber(day.output_tokens)}</td><td>{formatNumber(day.cache_read_tokens)}</td><td>{formatNumber(day.cache_create_tokens)}</td><td>{formatNumber(day.total_tokens)}</td><td>{formatCost(day.cost_usd)}</td><td>{formatLastSeen(day.last_seen_at)}</td></tr>)}</tbody></table></div></Card>
}

export function ClientDetailPage() {
  const { name = '' } = useParams()
  const query = useQuery({ queryKey: ['client-usage', name], queryFn: () => apiGet<ClientUsageResponse>(`/admin/config/client/usage${buildQuery({ name })}`), enabled: Boolean(name) })
  if (!name) return <Alert type="error" title="Client not found" content="The client name is missing." />
  if (query.isLoading) return <div className="page-stack client-detail-page"><Card bordered={false} loading title="Loading client usage" /></div>
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404
    return <div className="page-stack client-detail-page"><div className="console-hero compact-hero"><div><Typography.Title heading={3}>{missing ? 'Client not found' : 'Unable to load client'}</Typography.Title><Typography.Text type="secondary">{errorMessage(query.error)}</Typography.Text></div><Space><Link to="/clients"><Button icon={<IconLeft />}>Back to Clients</Button></Link><Button icon={<IconRefresh />} loading={query.isFetching} onClick={() => query.refetch()}>Retry</Button></Space></div><Alert type="error" title={missing ? '404 · Client not found' : 'Client usage unavailable'} content={errorMessage(query.error)} /></div>
  }
  const response = query.data!
  const activeDays = response.daily.filter((day) => day.request_count > 0).length
  return <div className="page-stack client-detail-page">
    <div className="console-hero compact-hero"><div><Tag color="arcoblue">Client detail</Tag><Typography.Title heading={3}>{response.client.name}</Typography.Title><Typography.Text type="secondary">Client-wide usage, quota, and inbound bindings.</Typography.Text></div><Space wrap><Link to="/clients"><Button icon={<IconLeft />}>Back to Clients</Button></Link><Button icon={<IconRefresh />} loading={query.isFetching} onClick={() => query.refetch()}>Refresh</Button></Space></div>
    <BindingsCard bindings={response.client.bindings || []} />
    <CoverageNotice response={response} />
    <Typography.Title heading={5} className="client-detail-section-title">Range summary · {response.start_date} through {shiftUTCDate(response.end_date, -1)} UTC</Typography.Title>
    <SummaryCards summary={response.range_summary} activeDays={activeDays} />
    <Row gutter={[14, 14]}><Col xs={24} lg={12}><Card bordered={false} className="panel-card tall-panel" title="All-time usage"><div className="client-all-time"><div><span>Requests</span><strong>{formatNumber(response.all_time.request_count)}</strong></div><div><span>Tokens</span><strong>{formatNumber(response.all_time.total_tokens)}</strong></div><div><span>Cost</span><strong>{formatCost(response.all_time.cost_usd)}</strong></div><div><span>Errors</span><strong>{formatNumber(response.all_time.error_count)}</strong></div><div><span>Last seen</span><strong>{formatLastSeen(response.all_time.last_seen_at)}</strong></div></div></Card></Col><Col xs={24} lg={12}><Card bordered={false} className="panel-card tall-panel" title="Quota"><QuotaSummary quota={response.quota} /></Card></Col></Row>
    <ContributionHeatmap response={response} />
    <DailyTable daily={response.daily} />
  </div>
}
