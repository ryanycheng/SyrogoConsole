import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, DatePicker, Grid, Select, Space, Table, Tag, Typography } from '@arco-design/web-react'
import type { TableColumnProps } from '@arco-design/web-react'
import { IconRefresh } from '@arco-design/web-react/icon'
import dayjs from 'dayjs'
import { apiGet, buildQuery } from '../../api/client'
import { errorMessage } from '../../api/errors'
import type { UsageResponse, UsageRow } from '../../api/types'

const { Row, Col } = Grid

const groupOptions = [
  { value: 'date', label: 'Date' },
  { value: 'agent', label: 'Agent' },
  { value: 'session', label: 'Session' },
  { value: 'model', label: 'Model' },
  { value: 'key', label: 'API key' },
  { value: 'provider', label: 'Provider' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'source', label: 'Source' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'error_kind', label: 'Error kind' },
] as const

const rangeOptions = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
] as const

type RangePreset = (typeof rangeOptions)[number]['value']
type DateRange = { startDate: string; endDate: string }

function formatUTCDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function shiftUTCDate(value: string, days: number): string {
  const [year, month, date] = value.split('-').map(Number)
  return formatUTCDate(new Date(Date.UTC(year, month - 1, date + days)))
}

function presetDateRange(preset: Exclude<RangePreset, 'custom'>, now = new Date()): DateRange {
  const today = formatUTCDate(now)
  const endDate = shiftUTCDate(today, 1)
  if (preset === 'month') {
    return { startDate: `${today.slice(0, 8)}01`, endDate }
  }
  return { startDate: shiftUTCDate(today, preset === '7d' ? -6 : -29), endDate }
}

function sumRows(rows: UsageRow[], key: keyof UsageRow): number {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0)
}

function formatNumber(value: unknown): string {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

function formatCost(value: unknown): string {
  const number = Number(value || 0)
  return number ? `$${number.toFixed(4)}` : '-'
}

function groupedValue(row: UsageRow): string {
  return typeof row.value === 'string' && row.value ? row.value : '-'
}

export function UsagePage() {
  const [groupBy, setGroupBy] = useState('date')
  const [rangePreset, setRangePreset] = useState<RangePreset>('7d')
  const [customRange, setCustomRange] = useState<[string, string]>()
  const dateRange = rangePreset === 'custom'
    ? customRange ? { startDate: customRange[0], endDate: shiftUTCDate(customRange[1], 1) } : undefined
    : presetDateRange(rangePreset)

  const query = useQuery({
    queryKey: ['usage', { group_by: groupBy, start_date: dateRange?.startDate, end_date: dateRange?.endDate }],
    queryFn: () => apiGet<UsageResponse>(`/admin/usage${buildQuery({
      group_by: groupBy,
      start_date: dateRange?.startDate,
      end_date: dateRange?.endDate,
    })}`),
    enabled: Boolean(dateRange),
  })

  const rows = useMemo(() => query.data?.items || query.data?.rows || [], [query.data])
  const totals = useMemo(
    () => ({
      requests: sumRows(rows, 'request_count'),
      tokens: sumRows(rows, 'total_tokens'),
      cache: sumRows(rows, 'cache_create_tokens') + sumRows(rows, 'cache_read_tokens'),
      cost: sumRows(rows, 'cost_usd'),
    }),
    [rows],
  )
  const groupLabel = groupOptions.find((option) => option.value === groupBy)?.label || 'Group'

  const columns: TableColumnProps<UsageRow>[] = [
    {
      key: 'group',
      title: groupLabel,
      dataIndex: 'value',
      fixed: 'left',
      width: 180,
      render: (_, record) => <Typography.Text bold>{groupedValue(record)}</Typography.Text>,
    },
    { title: 'Input', dataIndex: 'input_tokens', align: 'right', sorter: (a, b) => Number(a.input_tokens || 0) - Number(b.input_tokens || 0), render: formatNumber },
    { title: 'Output', dataIndex: 'output_tokens', align: 'right', sorter: (a, b) => Number(a.output_tokens || 0) - Number(b.output_tokens || 0), render: formatNumber },
    { title: 'Cache Create', dataIndex: 'cache_create_tokens', align: 'right', sorter: (a, b) => Number(a.cache_create_tokens || 0) - Number(b.cache_create_tokens || 0), render: formatNumber },
    { title: 'Cache Read', dataIndex: 'cache_read_tokens', align: 'right', sorter: (a, b) => Number(a.cache_read_tokens || 0) - Number(b.cache_read_tokens || 0), render: formatNumber },
    { title: 'Total Tokens', dataIndex: 'total_tokens', align: 'right', sorter: (a, b) => Number(a.total_tokens || 0) - Number(b.total_tokens || 0), render: formatNumber },
    { title: 'Cost (USD)', dataIndex: 'cost_usd', align: 'right', sorter: (a, b) => Number(a.cost_usd || 0) - Number(b.cost_usd || 0), render: formatCost },
    { title: 'Requests', dataIndex: 'request_count', align: 'right', width: 110, sorter: (a, b) => Number(a.request_count || 0) - Number(b.request_count || 0), render: formatNumber },
    { title: 'Errors', dataIndex: 'error_count', align: 'right', width: 100, render: (value) => (Number(value || 0) > 0 ? <Tag color="red">{value}</Tag> : <Tag color="green">0</Tag>) },
  ]

  function updateCustomRange(dateStrings: string[]) {
    setCustomRange(dateStrings.length === 2 && dateStrings[0] && dateStrings[1]
      ? [dateStrings[0], dateStrings[1]]
      : undefined)
  }

  return (
    <div className="page-stack usage-page">
      <div className="console-hero compact-hero">
        <div>
          <Tag color="purple">Accounting</Tag>
          <Typography.Title heading={3}>Usage Analytics</Typography.Title>
          <Typography.Text type="secondary">Billing-style usage grouped across a UTC date range.</Typography.Text>
        </div>
        <Button type="primary" icon={<IconRefresh />} loading={query.isFetching} disabled={!dateRange} onClick={() => query.refetch()}>
          Refresh
        </Button>
      </div>

      <Row gutter={[14, 14]}>
        <Col xs={24} sm={12} xl={6}>
          <Card bordered={false} className="metric-card metric-card-blue">
            <span className="metric-label">Requests</span>
            <strong>{formatNumber(totals.requests)}</strong>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bordered={false} className="metric-card metric-card-orange">
            <span className="metric-label">Total Tokens</span>
            <strong>{formatNumber(totals.tokens)}</strong>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bordered={false} className="metric-card metric-card-green">
            <span className="metric-label">Cache Tokens</span>
            <strong>{formatNumber(totals.cache)}</strong>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bordered={false} className="metric-card metric-card-gray">
            <span className="metric-label">Cost USD</span>
            <strong>{formatCost(totals.cost)}</strong>
          </Card>
        </Col>
      </Row>

      <Card bordered={false} className="toolbar-card">
        <Space wrap size={10}>
          <Select value={groupBy} onChange={setGroupBy} style={{ width: 190 }}>
            {groupOptions.map((option) => (
              <Select.Option key={option.value} value={option.value}>Group by {option.label}</Select.Option>
            ))}
          </Select>
          <Select value={rangePreset} onChange={setRangePreset} style={{ width: 170 }}>
            {rangeOptions.map((option) => (
              <Select.Option key={option.value} value={option.value}>{option.label}</Select.Option>
            ))}
          </Select>
          {rangePreset === 'custom' ? (
            <DatePicker.RangePicker
              format="YYYY-MM-DD"
              value={customRange ? [dayjs(customRange[0]), dayjs(customRange[1])] : undefined}
              onChange={updateCustomRange}
              placeholder={['Start date (UTC)', 'End date (UTC)']}
              style={{ width: 300 }}
            />
          ) : null}
        </Space>
      </Card>

      {query.isError ? <Alert type="error" title="Unable to load usage" content={errorMessage(query.error)} /> : null}

      <Card bordered={false} className="data-card panel-card" title="Usage Breakdown">
        <Table rowKey={(record) => groupedValue(record)} loading={query.isLoading} columns={columns} data={rows} pagination={{ pageSize: 12 }} scroll={{ x: 1100 }} />
      </Card>
    </div>
  )
}
