import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from '@arco-design/web-react'
import { IconRefresh } from '@arco-design/web-react/icon'
import dayjs, { type Dayjs } from 'dayjs'
import { apiGet, buildQuery, type QueryValue } from '../../api/client'
import { ApiError } from '../../api/errors'
import type { LogItem, LogsResponse } from '../../api/types'
import { PageHeader } from '../../components/PageHeader'

const rangeOptions = [
  { label: 'Last 5 minutes', value: '5m', minutes: 5 },
  { label: 'Last 15 minutes', value: '15m', minutes: 15 },
  { label: 'Last 1 hour', value: '1h', minutes: 60 },
  { label: 'Last 6 hours', value: '6h', minutes: 360 },
  { label: 'Last 24 hours', value: '24h', minutes: 1440 },
  { label: 'Custom range', value: 'custom', minutes: 0 },
] as const

const filterFields = new Set(['level', 'status', 'client', 'inbound', 'outbound', 'error_kind'])

function parseQuery(value: string): Record<string, string> {
  const result: Record<string, string[]> = { q: [] }
  const tokens = value.match(/(?:[^\s"]+|"[^"]*")+/g) || []
  for (const token of tokens) {
    const separator = token.indexOf(':')
    const field = separator > 0 ? token.slice(0, separator).toLowerCase() : ''
    const raw = separator > 0 ? token.slice(separator + 1) : token
    const normalized = raw.replace(/^"|"$/g, '').trim()
    if (!normalized) continue
    const key = filterFields.has(field) ? field : 'q'
    result[key] = [...(result[key] || []), normalized]
  }
  return Object.fromEntries(Object.entries(result).filter(([, items]) => items.length).map(([key, items]) => [key, items.join(',')]))
}

function levelColor(level?: string): string {
  if (level === 'ERROR') return 'red'
  if (level === 'WARN') return 'orange'
  if (level === 'INFO') return 'blue'
  return 'gray'
}

function statusColor(status?: number): string {
  if (!status) return 'gray'
  if (status >= 500) return 'red'
  if (status >= 400) return 'orange'
  if (status >= 300) return 'purple'
  return 'green'
}

function itemsFromPages(pages: LogsResponse[]): LogItem[] {
  return [...pages].reverse().flatMap((page) => page.items || [])
}

export function LogsPage() {
  const [range, setRange] = useState('5m')
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs]>()
  const [limit, setLimit] = useState(200)
  const [draftQuery, setDraftQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [refreshSeconds, setRefreshSeconds] = useState(30)
  const [anchorUntil, setAnchorUntil] = useState(() => dayjs().toISOString())
  const logTableRef = useRef<HTMLDivElement>(null)
  const rangeMinutes = rangeOptions.find((option) => option.value === range)?.minutes || 5
  const since = range === 'custom' && customRange ? customRange[0].toISOString() : dayjs(anchorUntil).subtract(rangeMinutes, 'minute').toISOString()
  const until = range === 'custom' && customRange ? customRange[1].toISOString() : anchorUntil
  const filters = useMemo(() => parseQuery(appliedQuery), [appliedQuery])

  const query = useInfiniteQuery({
    queryKey: ['logs', since, until, limit, filters],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const params: Record<string, QueryValue> = { since, until, limit, cursor: pageParam }
      Object.assign(params, filters)
      return apiGet<LogsResponse>(`/admin/logs${buildQuery(params)}`)
    },
    getNextPageParam: (lastPage) => (lastPage.has_more && lastPage.next_cursor ? lastPage.next_cursor : undefined),
  })

  useEffect(() => {
    if (range === 'custom' || refreshSeconds <= 0) return
    const timer = window.setInterval(() => setAnchorUntil(dayjs().toISOString()), refreshSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [range, refreshSeconds])

  useEffect(() => {
    const container = logTableRef.current?.querySelector('.arco-table-body')
    if (!container || !query.hasNextPage) return
    const handleScroll = () => {
      if (query.isFetchingNextPage) return
      if (container.scrollHeight - container.scrollTop - container.clientHeight <= 160) {
        void query.fetchNextPage()
      }
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage])

  const pages = query.data?.pages || []
  const firstPage = pages[0]
  const items = useMemo(() => itemsFromPages(pages), [pages])
  const loadedLines = pages.reduce((total, page) => total + Number(page.matched_count ?? page.line_count ?? 0), 0)
  const scannedLines = pages.reduce((total, page) => total + Number(page.scanned_line_count || 0), 0)
  const bytesRead = pages.reduce((total, page) => total + Number(page.bytes_read || 0), 0)
  const scannedFiles = pages.reduce((total, page) => total + Number(page.scanned_file_count || 0), 0)
  const source = firstPage?.source === 'memory' ? 'Memory' : 'File'
  const archiveSummary = pages.some((page) => page.includes_archives)
    ? ` · ${scannedFiles} files including history`
    : scannedFiles > 1 ? ` · ${scannedFiles} files` : ''
  const staleCursor = query.error instanceof ApiError && query.error.status === 409

  function resetSnapshot() {
    const nextQuery = draftQuery.trim()
    if (nextQuery !== appliedQuery) {
      setAppliedQuery(nextQuery)
      if (range !== 'custom') setAnchorUntil(dayjs().toISOString())
      return
    }
    if (range !== 'custom') setAnchorUntil(dayjs().toISOString())
    else void query.refetch()
  }

  function updateRange(value: string) {
    setRange(value)
    if (value !== 'custom') setAnchorUntil(dayjs().toISOString())
  }

  function updateLimit(value: number | undefined) {
    setLimit(Math.min(1000, Math.max(1, Number(value) || 200)))
    resetSnapshot()
  }

  function applyQuery(value = draftQuery) {
    setAppliedQuery(value.trim())
    if (range !== 'custom') setAnchorUntil(dayjs().toISOString())
  }

  function addFilter(filter: string) {
    const next = [draftQuery.trim(), filter].filter(Boolean).join(' ')
    setDraftQuery(next)
    applyQuery(next)
  }

  const columns = [
    {
      title: 'Time', dataIndex: 'time', width: 190,
      render: (value: string | undefined) => value ? dayjs(value).format('MM-DD HH:mm:ss.SSS') : '-',
    },
    {
      title: 'Level', dataIndex: 'level', width: 90,
      render: (value: string | undefined) => <Tag color={levelColor(value)}>{value || 'RAW'}</Tag>,
    },
    {
      title: 'Status', dataIndex: 'status', width: 90,
      render: (value: number | undefined) => value ? <Tag color={statusColor(value)}>{value}</Tag> : '-',
    },
    { title: 'Message', dataIndex: 'message', ellipsis: true },
    { title: 'Client', dataIndex: 'client', width: 130, ellipsis: true },
    { title: 'Inbound', dataIndex: 'inbound', width: 120, ellipsis: true },
    {
      title: 'Outbound', dataIndex: 'outbound', width: 160, ellipsis: true,
      render: (value: string[] | undefined) => value?.join(', ') || '-',
    },
    { title: 'Duration', dataIndex: 'duration', width: 130, className: 'log-duration-cell' },
  ]

  return (
    <div className="page-stack logs-page">
      <PageHeader title="Logs" description="Search redacted local logs with server-side time and field filters." />
      <Card bordered={false} className="toolbar-card log-search-card">
        <Input.Search
          value={draftQuery}
          onChange={setDraftQuery}
          onSearch={applyQuery}
          onPressEnter={() => applyQuery()}
          placeholder={'Search text or use level:ERROR status:5xx client:"Claude Code"'}
          searchButton="Search"
          allowClear
        />
        <div className="log-filter-row">
          <Space wrap size={8}>
            <Button size="small" onClick={() => addFilter('level:ERROR')}>Errors</Button>
            <Button size="small" onClick={() => addFilter('level:WARN')}>Warnings</Button>
            <Button size="small" onClick={() => addFilter('status:5xx')}>5xx</Button>
            <Button size="small" onClick={() => addFilter('status:4xx')}>4xx</Button>
            {appliedQuery ? <Button size="small" status="danger" onClick={() => { setDraftQuery(''); applyQuery('') }}>Clear filters</Button> : null}
          </Space>
          <Space wrap size={8}>
            <Select value={range} onChange={updateRange} style={{ width: 170 }}>
              {rangeOptions.map((option) => <Select.Option key={option.value} value={option.value}>{option.label}</Select.Option>)}
            </Select>
            {range === 'custom' ? (
              <DatePicker.RangePicker
                showTime
                value={customRange}
                onChange={(_, dates) => setCustomRange(dates.length === 2 ? [dates[0], dates[1]] : undefined)}
                style={{ width: 360 }}
              />
            ) : null}
            <Select value={refreshSeconds} onChange={setRefreshSeconds} disabled={range === 'custom'} style={{ width: 170 }}>
              <Select.Option value={0}>Auto refresh: Off</Select.Option>
              <Select.Option value={5}>Auto refresh: 5s</Select.Option>
              <Select.Option value={10}>Auto refresh: 10s</Select.Option>
              <Select.Option value={30}>Auto refresh: 30s</Select.Option>
            </Select>
            <InputNumber min={1} max={1000} value={limit} onChange={updateLimit} suffix="rows" style={{ width: 130 }} />
            <Button icon={<IconRefresh />} loading={query.isFetching && !query.isFetchingNextPage} onClick={resetSnapshot}>Refresh</Button>
          </Space>
        </div>
      </Card>
      <Card bordered={false} className="data-card log-summary-card">
        <Descriptions
          column={{ xs: 1, sm: 2, lg: 3 }}
          data={[
            { label: 'Path', value: firstPage?.path || '-' },
            { label: 'Time range', value: `${dayjs(since).format('MM-DD HH:mm:ss')} — ${dayjs(until).format('HH:mm:ss')}` },
            { label: 'Results', value: `${source} · ${loadedLines} matched · ${scannedLines} scanned · ${new Intl.NumberFormat('en-US').format(bytesRead)} bytes${archiveSummary}` },
          ]}
        />
      </Card>
      <Card bordered={false} className="log-card">
        {query.error ? (
          <div className="log-error-row">
            <Typography.Text type="error">
              {staleCursor ? 'The log file changed during pagination. Refresh to start a new snapshot.' : query.error instanceof Error ? query.error.message : 'Failed to load logs'}
            </Typography.Text>
            {staleCursor ? <Button size="mini" onClick={resetSnapshot}>Refresh</Button> : null}
          </div>
        ) : null}
        <div ref={logTableRef}>
          <Table
            rowKey={(item) => `${item.time || ''}:${item.content}`}
            columns={columns}
            data={items}
            loading={query.isLoading}
            pagination={false}
            scroll={{ x: 1160, y: 520 }}
            noDataElement="No logs match this query"
            expandedRowRender={(item) => (
              <div className="log-detail">
                {item.fields && Object.keys(item.fields).length ? <pre>{JSON.stringify(item.fields, null, 2)}</pre> : null}
                <pre>{item.content}</pre>
              </div>
            )}
          />
        </div>
        <div className="log-pagination">
          <Typography.Text type="secondary">
            {query.hasNextPage ? 'Scroll here to load earlier logs automatically. Filtering is applied by the server.' : `All matching logs in this range are loaded with a ${limit}-row page limit.`}
          </Typography.Text>
          <Button disabled={!query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.hasNextPage ? 'Load earlier logs' : 'No earlier logs'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
