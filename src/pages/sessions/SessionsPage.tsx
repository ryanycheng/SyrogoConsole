import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, Grid, Input, Radio, Select, Space, Table, Tag, Typography } from '@arco-design/web-react'
import type { TableColumnProps } from '@arco-design/web-react'
import { IconClockCircle, IconRefresh, IconStar, IconStarFill } from '@arco-design/web-react/icon'
import dayjs from 'dayjs'
import { apiGet, buildQuery } from '../../api/client'
import type { SessionItem, SessionsResponse, StatusKind } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'

const { Row, Col } = Grid
const viewStorageKey = 'syrogo_console_sessions_view'
const refreshStorageKey = 'syrogo_console_sessions_refresh_interval'
const favoriteStorageKey = 'syrogo_console_favorite_sessions'
const recentStopWindowMs = 30 * 60 * 1000
const statusOptions = ['', 'running', 'tool_running', 'waiting_permission', 'idle', 'compacting', 'stopped', 'unknown']
const refreshOptions = [
  { label: 'Off', value: '0', interval: false },
  { label: '2s', value: '2000', interval: 2000 },
  { label: '5s', value: '5000', interval: 5000 },
  { label: '10s', value: '10000', interval: 10000 },
  { label: '30s', value: '30000', interval: 30000 },
  { label: '1m', value: '60000', interval: 60000 },
] as const

function loadFavoriteSessionIds(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(favoriteStorageKey) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

type ViewMode = 'cards' | 'table'

interface SessionFilters {
  client: string
  status: string
  host: string
  cwd: string
}

function statusKind(status?: string): StatusKind {
  if (status === 'waiting_permission') return 'danger'
  if (status === 'tool_running' || status === 'compacting') return 'warn'
  if (status === 'idle' || status === 'stopped' || status === 'unknown') return 'muted'
  return 'ok'
}

function tagColor(kind: StatusKind): string {
  if (kind === 'danger') return 'red'
  if (kind === 'warn') return 'orange'
  if (kind === 'muted') return 'gray'
  return 'green'
}

function formatDuration(startedAt?: string, endedAt?: string): string {
  if (!startedAt) return '-'
  const start = dayjs(startedAt)
  if (!start.isValid()) return '-'
  const end = endedAt ? dayjs(endedAt) : dayjs()
  const seconds = Math.max(0, end.diff(start, 'second'))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function commandLabel(item: SessionItem): string {
  return item.command?.join(' ') || '-'
}

function workspaceLabel(value?: string): string {
  if (!value) return '-'
  const parts = value.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : value
}

function formatTime(value?: string): string {
  if (!value) return '-'
  return dayjs(value).format('MM-DD HH:mm:ss')
}

function tmuxLocation(item: SessionItem): string {
  const tmux = item.tmux || {}
  if (!tmux.present) return 'not in tmux'
  const window = `w${tmux.window_index || '-'}${tmux.window_name ? ` · ${tmux.window_name}` : ''}`
  const pane = `p${tmux.pane_id || tmux.pane_index || '-'}`
  return [tmux.session || '-', window, pane].join(' / ')
}

function primaryCommand(item: SessionItem): string {
  return item.commands?.attach || item.commands?.select_window || item.commands?.select_pane || ''
}

function metricCount(items: SessionItem[], predicate: (item: SessionItem) => boolean): number {
  return items.filter(predicate).length
}

function isRecentlyStopped(item: SessionItem, now: number): boolean {
  if (item.status !== 'idle' || item.last_event !== 'Stop' || !item.last_seen_at) return false
  const stoppedAt = dayjs(item.last_seen_at)
  if (!stoppedAt.isValid()) return false
  return Math.max(0, now - stoppedAt.valueOf()) <= recentStopWindowMs
}

export function SessionsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>(() => (window.localStorage.getItem(viewStorageKey) === 'table' ? 'table' : 'cards'))
  const [refreshInterval, setRefreshInterval] = useState(() => window.localStorage.getItem(refreshStorageKey) || '5000')
  const [favoriteIds, setFavoriteIds] = useState<string[]>(loadFavoriteSessionIds)
  const [filters, setFilters] = useState<SessionFilters>({ client: '', status: '', host: '', cwd: '' })
  const [now, setNow] = useState(Date.now)
  const refreshOption = refreshOptions.find((option) => option.value === refreshInterval) || refreshOptions[2]
  const query = useQuery({
    queryKey: ['sessions', filters],
    queryFn: () => apiGet<SessionsResponse>(`/admin/sessions${buildQuery({ ...filters })}`),
    refetchInterval: refreshOption.interval,
  })
  const items = useMemo(() => query.data?.items || [], [query.data])
  const sessionGroups = useMemo(
    () => ({
      current: items.filter((item) => item.status !== 'stopped'),
      ended: items.filter((item) => item.status === 'stopped'),
    }),
    [items],
  )
  const favoriteItems = useMemo(() => {
    const idSet = new Set(favoriteIds)
    return [...sessionGroups.current, ...sessionGroups.ended].filter((item) => idSet.has(item.id))
  }, [favoriteIds, sessionGroups])
  const counts = useMemo(
    () => ({
      action: metricCount(items, (item) => item.status === 'waiting_permission'),
      active: metricCount(items, (item) => item.status === 'running' || item.status === 'tool_running' || item.status === 'compacting'),
      idle: metricCount(items, (item) => item.status === 'idle' || item.status === 'unknown'),
      recentStop: metricCount(items, (item) => isRecentlyStopped(item, now)),
      ended: sessionGroups.ended.length,
    }),
    [items, now, sessionGroups.ended.length],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(viewStorageKey, viewMode)
  }, [viewMode])

  useEffect(() => {
    window.localStorage.setItem(refreshStorageKey, refreshInterval)
  }, [refreshInterval])

  useEffect(() => {
    window.localStorage.setItem(favoriteStorageKey, JSON.stringify(favoriteIds))
  }, [favoriteIds])

  const columns: TableColumnProps<SessionItem>[] = [
    {
      title: '',
      width: 52,
      render: (_, record) => renderFavoriteButton(record),
    },
    {
      title: 'Status',
      width: 190,
      render: (_, record) => (
        <Space size={4} wrap>
          <Tag color={tagColor(statusKind(record.status))}>{record.status || 'unknown'}</Tag>
          {isRecentlyStopped(record, now) && <Tag color="arcoblue">Recently stopped</Tag>}
        </Space>
      ),
    },
    { title: 'Client', dataIndex: 'client_name', width: 160, ellipsis: true, render: (value) => value || '-' },
    { title: 'Inbound', dataIndex: 'inbound_name', width: 160, ellipsis: true, render: (value) => value || '-' },
    { title: 'Location', width: 220, ellipsis: true, render: (_, record) => tmuxLocation(record) },
    { title: 'Workspace', dataIndex: 'cwd', width: 220, ellipsis: true, render: (value) => value || '-' },
    { title: 'Last seen', dataIndex: 'last_seen_at', width: 150, render: (value, record) => formatTime(value || record.started_at) },
    { title: 'Command', width: 240, render: (_, record) => <Typography.Text copyable={{ text: primaryCommand(record) }}>{primaryCommand(record) || '-'}</Typography.Text> },
  ]

  function updateFilter(key: keyof SessionFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function toggleFavorite(id: string) {
    setFavoriteIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  function renderFavoriteButton(item: SessionItem) {
    const favorited = favoriteIds.includes(item.id)
    return (
      <Button
        aria-label={`${favorited ? 'Unfavorite' : 'Favorite'} session ${item.id}`}
        className="favorite-button"
        type="text"
        size="mini"
        icon={favorited ? <IconStarFill /> : <IconStar />}
        onClick={() => toggleFavorite(item.id)}
      />
    )
  }

  function renderSessionCard(item: SessionItem, compact = false) {
    const kind = statusKind(item.status)
    const command = primaryCommand(item)
    const runtime = formatDuration(item.started_at, item.stopped_at)
    const recentStop = isRecentlyStopped(item, now)
    return (
      <Card key={item.id} className={`session-card session-card-${kind}${recentStop ? ' session-card-recent-stop' : ''}${compact ? ' favorite-session-card' : ''}`} bordered={false}>
        <div className="session-card-head">
          <div className="session-status-line">
            <Badge status={kind === 'danger' ? 'error' : kind === 'warn' ? 'warning' : kind === 'muted' ? 'default' : 'success'} />
            <Tag color={tagColor(kind)}>{item.status || 'unknown'}</Tag>
            <Typography.Text title={item.last_event || 'no hook'} type="secondary" className="session-event">
              {item.last_event || 'no hook'}
            </Typography.Text>
          </div>
          {renderFavoriteButton(item)}
        </div>
        <div className="session-card-main">
          <div>
            <Typography.Title title={item.client_name || '-'} heading={6} className="session-title">
              {item.client_name || '-'}
            </Typography.Title>
            <Typography.Text title={`${item.inbound_name || '-'} · ${workspaceLabel(item.cwd)}`} type="secondary" className="single-line">
              {item.inbound_name || '-'} · {workspaceLabel(item.cwd)}
            </Typography.Text>
          </div>
          <div className="session-runtime">
            <IconClockCircle />
            <span>{runtime}</span>
          </div>
        </div>
        <div className="session-chip-row">
          {recentStop && <Tag color="arcoblue">Recently stopped</Tag>}
          <Tag title={item.git_branch || 'no branch'}>{item.git_branch || 'no branch'}</Tag>
          <Tag>pid {item.pid || '-'}</Tag>
          <Tag>{formatTime(item.last_seen_at || item.started_at)}</Tag>
        </div>
        <div className="session-meta">
          <span>tmux</span>
          <strong title={tmuxLocation(item)}>{tmuxLocation(item)}</strong>
          <span>cwd</span>
          <strong title={item.cwd || '-'}>{item.cwd || '-'}</strong>
          <span>host</span>
          <strong title={item.host || '-'}>{item.host || '-'}</strong>
          {!compact && (
            <>
              <span>cmd</span>
              <strong title={commandLabel(item)}>{commandLabel(item)}</strong>
            </>
          )}
        </div>
        {!compact && (
          <Typography.Text className="session-command" copyable={command ? { text: command } : false}>
            {command || 'No tmux command'}
          </Typography.Text>
        )}
      </Card>
    )
  }

  function renderSessionSection(title: string, description: string, sectionItems: SessionItem[]) {
    if (sectionItems.length === 0) return null
    return (
      <section className="session-section" aria-label={title}>
        <div className="session-section-head">
          <div>
            <Typography.Title heading={5}>{title}</Typography.Title>
            <Typography.Text type="secondary">{description}</Typography.Text>
          </div>
          <Tag>{sectionItems.length}</Tag>
        </div>
        {viewMode === 'cards' ? (
          <div className="session-grid">{sectionItems.map((item) => renderSessionCard(item))}</div>
        ) : (
          <Card bordered={false} className="panel-card session-table-card">
            <Table
              rowKey="id"
              loading={query.isLoading}
              columns={columns}
              data={sectionItems}
              pagination={{ pageSize: 12 }}
              scroll={{ x: 1394 }}
            />
          </Card>
        )}
      </section>
    )
  }

  return (
    <div className="page-stack sessions-page">
      <div className="console-hero compact-hero">
        <div>
          <Tag color="green">Live Sessions</Tag>
          <Typography.Title heading={3}>Session Control</Typography.Title>
          <Typography.Text type="secondary">
            Claude Code sessions registered by syrogo run claude. Auto refresh is {refreshOption.label === 'Off' ? 'off' : `every ${refreshOption.label}`}.
          </Typography.Text>
        </div>
        <Space>
          <Select value={refreshInterval} onChange={setRefreshInterval} style={{ width: 128 }}>
            {refreshOptions.map((option) => (
              <Select.Option key={option.value} value={option.value}>
                Refresh {option.label}
              </Select.Option>
            ))}
          </Select>
          <Radio.Group type="button" value={viewMode} onChange={setViewMode}>
            <Radio value="cards">Cards</Radio>
            <Radio value="table">Table</Radio>
          </Radio.Group>
          <Button type="primary" icon={<IconRefresh />} loading={query.isFetching} onClick={() => query.refetch()}>
            Refresh
          </Button>
        </Space>
      </div>

      {favoriteItems.length > 0 && (
        <Card bordered={false} className="favorite-sessions-card" title="Favorite Sessions">
          <div className="favorite-session-grid">{favoriteItems.map((item) => renderSessionCard(item, true))}</div>
        </Card>
      )}

      <Row gutter={[10, 10]}>
        <Col xs={12} xl={6}>
          <Card bordered={false} className="session-stat-card session-stat-danger">
            <span>Needs action</span>
            <strong>{counts.action}</strong>
            <small>waiting permission</small>
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card bordered={false} className="session-stat-card session-stat-warn">
            <span>Active</span>
            <strong>{counts.active}</strong>
            <small>running or tool use</small>
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card bordered={false} className="session-stat-card session-stat-blue">
            <span>Idle</span>
            <strong>{counts.idle}</strong>
            <small>{counts.recentStop} recently stopped</small>
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card bordered={false} className="session-stat-card session-stat-muted">
            <span>Ended</span>
            <strong>{counts.ended}</strong>
            <small>SessionEnd or process exited</small>
          </Card>
        </Col>
      </Row>

      <Card bordered={false} className="toolbar-card">
        <Space wrap size={10}>
          <Input value={filters.client} onChange={(value) => updateFilter('client', value)} placeholder="Client" style={{ width: 190 }} />
          <Select value={filters.status} onChange={(value) => updateFilter('status', value)} style={{ width: 190 }}>
            {statusOptions.map((option) => (
              <Select.Option key={option || 'all'} value={option}>
                {option || 'All statuses'}
              </Select.Option>
            ))}
          </Select>
          <Input value={filters.host} onChange={(value) => updateFilter('host', value)} placeholder="Host" style={{ width: 190 }} />
          <Input value={filters.cwd} onChange={(value) => updateFilter('cwd', value)} placeholder="Working directory" style={{ width: 260 }} />
        </Space>
      </Card>

      {items.length === 0 ? (
        <EmptyState description="No Claude Code sessions yet." />
      ) : (
        <div className="session-sections">
          {renderSessionSection('Current sessions', 'Running terminals, pending work, and idle sessions available to continue.', sessionGroups.current)}
          {renderSessionSection('Ended sessions', 'Sessions closed by SessionEnd or process exit.', sessionGroups.ended)}
        </div>
      )}
    </div>
  )
}
