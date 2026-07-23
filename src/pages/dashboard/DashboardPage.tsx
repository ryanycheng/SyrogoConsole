import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Grid, Progress, Space, Spin, Tag, Typography } from '@arco-design/web-react'
import { IconRefresh } from '@arco-design/web-react/icon'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { apiGet, buildQuery } from '../../api/client'
import type {
  LatencyTrace,
  LatencyTracesResponse,
  OverviewResponse,
  ProviderDebugResponse,
  ProviderHealthItem,
  QuotaItem,
  SessionItem,
  SessionsResponse,
  UsageResponse,
  UsageRow,
} from '../../api/types'

const { Row, Col } = Grid
const refreshInterval = 5000

function sumRows(rows: UsageRow[], key: keyof UsageRow): number {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatCost(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`
}

function formatTime(value?: string): string {
  if (!value) return '-'
  const time = dayjs(value)
  return time.isValid() ? time.format('HH:mm:ss') : '-'
}

function isActiveSession(item: SessionItem): boolean {
  return item.status === 'running' || item.status === 'tool_running' || item.status === 'compacting'
}

function isQuotaAction(item: QuotaItem): boolean {
  return item.state === 'limited' || item.state === 'cooldown'
}

function isProviderAction(item: ProviderHealthItem): boolean {
  return item.state === 'degraded' || item.state === 'probing'
}

function healthColor(state: string): string {
  if (state === 'available') return 'green'
  if (state === 'probing') return 'orange'
  return 'red'
}

function traceIsError(trace: LatencyTrace): boolean {
  return Boolean(trace.error_kind) || Number(trace.status || 0) >= 400
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed'
}

export function DashboardPage() {
  const navigate = useNavigate()
  const today = dayjs().format('YYYY-MM-DD')
  const overviewQuery = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => apiGet<OverviewResponse>('/admin/overview'),
    refetchInterval: refreshInterval,
  })
  const usageQuery = useQuery({
    queryKey: ['dashboard-usage', today],
    queryFn: () => apiGet<UsageResponse>(`/admin/usage${buildQuery({ group_by: 'key', window: 'day', bucket: today })}`),
    refetchInterval: refreshInterval,
  })
  const sessionsQuery = useQuery({
    queryKey: ['dashboard-sessions'],
    queryFn: () => apiGet<SessionsResponse>('/admin/sessions'),
    refetchInterval: refreshInterval,
  })
  const providersQuery = useQuery({
    queryKey: ['dashboard-providers'],
    queryFn: () => apiGet<ProviderDebugResponse>('/admin/debug/providers'),
    refetchInterval: refreshInterval,
  })
  const tracesQuery = useQuery({
    queryKey: ['dashboard-traces'],
    queryFn: () => apiGet<LatencyTracesResponse>('/admin/debug/traces'),
    refetchInterval: refreshInterval,
  })

  const queries = [overviewQuery, usageQuery, sessionsQuery, providersQuery, tracesQuery]
  const isLoading = queries.every((query) => query.isLoading)
  const isFetching = queries.some((query) => query.isFetching)
  const failedQueries = [
    ['Gateway overview', overviewQuery.error],
    ['Today usage', usageQuery.error],
    ['Sessions', sessionsQuery.error],
    ['Provider health', providersQuery.error],
    ['Recent traces', tracesQuery.error],
  ].filter((entry) => entry[1])
  const lastUpdatedAt = Math.max(...queries.map((query) => query.dataUpdatedAt || 0))

  const usageRows = useMemo(() => usageQuery.data?.items || usageQuery.data?.rows || [], [usageQuery.data])
  const sessions = sessionsQuery.data?.items || []
  const providerHealth = providersQuery.data?.health || []
  const quotaItems = [...(providersQuery.data?.outbound_quota || []), ...(providersQuery.data?.client_quota || [])]
  const traces = tracesQuery.data?.items || []

  const totals = useMemo(() => {
    const requests = sumRows(usageRows, 'request_count')
    const errors = sumRows(usageRows, 'error_count')
    return {
      requests,
      errors,
      errorRate: requests > 0 ? (errors / requests) * 100 : 0,
      tokens: sumRows(usageRows, 'total_tokens'),
      input: sumRows(usageRows, 'input_tokens'),
      output: sumRows(usageRows, 'output_tokens'),
      cacheCreate: sumRows(usageRows, 'cache_create_tokens'),
      cacheRead: sumRows(usageRows, 'cache_read_tokens'),
      cost: sumRows(usageRows, 'cost_usd'),
    }
  }, [usageRows])

  const waitingSessions = sessions.filter((item) => item.status === 'waiting_permission')
  const activeSessions = sessions.filter(isActiveSession)
  const unhealthyProviders = providerHealth.filter(isProviderAction)
  const pressuredQuota = quotaItems.filter(isQuotaAction)
  const needsAction = waitingSessions.length + unhealthyProviders.length + pressuredQuota.length
  const recentErrors = traces
    .filter(traceIsError)
    .sort((a, b) => dayjs(b.started_at).valueOf() - dayjs(a.started_at).valueOf())
    .slice(0, 6)

  function refreshAll() {
    queries.forEach((query) => void query.refetch())
  }

  return (
    <div className="page-stack dashboard-page">
      <div className="console-hero compact-hero dashboard-hero">
        <div>
          <Space size={8}>
            <Tag color={overviewQuery.isSuccess ? 'green' : overviewQuery.isError ? 'red' : 'orange'}>
              {overviewQuery.isSuccess ? 'Gateway online' : overviewQuery.isError ? 'Gateway unavailable' : 'Connecting'}
            </Tag>
            <Typography.Text type="secondary">Auto refresh 5s · Updated {lastUpdatedAt ? dayjs(lastUpdatedAt).format('HH:mm:ss') : '-'}</Typography.Text>
          </Space>
          <Typography.Title heading={3}>Operations Dashboard</Typography.Title>
          <Typography.Text type="secondary">Current health, today&apos;s usage and items that need attention.</Typography.Text>
        </div>
        <Button type="primary" icon={<IconRefresh />} loading={isFetching} onClick={refreshAll}>Refresh</Button>
      </div>

      {failedQueries.length > 0 && (
        <Card bordered={false} className="dashboard-warning-card">
          <Typography.Text bold>Partial data unavailable: </Typography.Text>
          <Typography.Text type="secondary">
            {failedQueries.map(([name, error]) => `${name} (${errorMessage(error)})`).join(' · ')}
          </Typography.Text>
        </Card>
      )}

      <Spin loading={isLoading} block>
        <Row gutter={[14, 14]}>
          <Col xs={24} sm={12} xl={6}>
            <Card bordered={false} className={`metric-card ${needsAction > 0 ? 'metric-card-red' : 'metric-card-green'}`}>
              <span className="metric-label">Needs Action</span>
              <strong>{formatNumber(needsAction)}</strong>
              <Typography.Text type="secondary">Sessions, providers and quota</Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card bordered={false} className="metric-card metric-card-blue">
              <span className="metric-label">Active Sessions</span>
              <strong>{formatNumber(activeSessions.length)}</strong>
              <Typography.Text type="secondary">{sessions.length} sessions currently retained</Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card bordered={false} className={totals.errors > 0 ? 'metric-card metric-card-red' : 'metric-card metric-card-green'}>
              <span className="metric-label">Today Requests</span>
              <strong>{formatNumber(totals.requests)}</strong>
              <Typography.Text type="secondary">{totals.errorRate.toFixed(2)}% error rate · {totals.errors} errors</Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card bordered={false} className="metric-card metric-card-orange">
              <span className="metric-label">Today Cost</span>
              <strong>{formatCost(totals.cost)}</strong>
              <Typography.Text type="secondary">{formatNumber(totals.tokens)} total tokens</Typography.Text>
            </Card>
          </Col>
        </Row>

        <Row gutter={[14, 14]}>
          <Col xs={24} xl={14}>
            <Card bordered={false} className="panel-card tall-panel" title="Needs Attention" extra={<Button type="text" onClick={() => navigate('/sessions')}>View Sessions</Button>}>
              {needsAction === 0 ? (
                <div className="dashboard-clear-state">
                  <Tag color="green">All clear</Tag>
                  <Typography.Text type="secondary">No session, provider or quota intervention is required.</Typography.Text>
                </div>
              ) : (
                <div className="attention-list">
                  {waitingSessions.map((session) => (
                    <button key={session.id} className="attention-item" onClick={() => navigate('/sessions')}>
                      <Tag color="red">Permission</Tag>
                      <span><strong>{session.client_name || session.id}</strong><small>{session.cwd || session.inbound_name || 'Waiting for user action'}</small></span>
                      <time>{formatTime(session.last_seen_at)}</time>
                    </button>
                  ))}
                  {unhealthyProviders.map((provider) => (
                    <div key={provider.outbound} className="attention-item">
                      <Tag color={healthColor(provider.state)}>{provider.state}</Tag>
                      <span><strong>{provider.outbound}</strong><small>{provider.last_error_kind || `${provider.consecutive_failures || 0} consecutive failures`}</small></span>
                      <time>{formatTime(provider.last_failure_at)}</time>
                    </div>
                  ))}
                  {pressuredQuota.map((quota, index) => (
                    <div key={`${quota.outbound || quota.client || 'quota'}-${index}`} className="attention-item">
                      <Tag color="orange">{quota.state}</Tag>
                      <span><strong>{quota.outbound || quota.client || 'Quota'}</strong><small>{quota.inbound || 'Request capacity is constrained'}</small></span>
                      <time>{formatTime(quota.cooldown_until || quota.next_probe_at)}</time>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            <Card bordered={false} className="panel-card tall-panel" title="Today Usage" extra={<Button type="text" onClick={() => navigate('/usage')}>Open Usage</Button>}>
              <div className="usage-snapshot">
                <div><span>Input</span><strong>{formatNumber(totals.input)}</strong></div>
                <div><span>Output</span><strong>{formatNumber(totals.output)}</strong></div>
                <div><span>Cache Create</span><strong>{formatNumber(totals.cacheCreate)}</strong></div>
                <div><span>Cache Read</span><strong>{formatNumber(totals.cacheRead)}</strong></div>
              </div>
              <div className="error-rate-row">
                <span>Success rate</span>
                <strong>{(100 - totals.errorRate).toFixed(2)}%</strong>
              </div>
              <Progress percent={Math.max(0, 100 - totals.errorRate)} showText={false} status={totals.errors > 0 ? 'warning' : 'success'} />
            </Card>
          </Col>
        </Row>

        <Row gutter={[14, 14]}>
          <Col xs={24} xl={10}>
            <Card bordered={false} className="panel-card tall-panel" title="Provider Health">
              {providerHealth.length === 0 ? (
                <Typography.Text type="secondary">No provider health data.</Typography.Text>
              ) : (
                <div className="provider-health-list">
                  {providerHealth.map((provider) => (
                    <div key={provider.outbound}>
                      <span><i className={`health-dot health-dot-${provider.state}`} />{provider.outbound}</span>
                      <Tag color={healthColor(provider.state)}>{provider.state}</Tag>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Col>
          <Col xs={24} xl={14}>
            <Card bordered={false} className="panel-card tall-panel" title="Recent Errors" extra={<Button type="text" onClick={() => navigate('/logs')}>Open Logs</Button>}>
              {recentErrors.length === 0 ? (
                <div className="dashboard-clear-state">
                  <Tag color="green">No recent errors</Tag>
                  <Typography.Text type="secondary">The in-memory trace window contains no failed requests.</Typography.Text>
                </div>
              ) : (
                <div className="recent-error-list">
                  {recentErrors.map((trace) => (
                    <div key={trace.request_id}>
                      <Tag color="red">{trace.status || 'Error'}</Tag>
                      <span><strong>{trace.error_kind || trace.path || 'Request failed'}</strong><small>{trace.client_name || trace.inbound || '-'} · {trace.outbound_name || 'no outbound'} · {trace.duration_ms || 0}ms</small></span>
                      <time>{formatTime(trace.started_at)}</time>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  )
}
