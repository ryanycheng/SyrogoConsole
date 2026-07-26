import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientDetailPage } from './ClientDetailPage'
import { buildContributionWeeks, contributionLevel } from './contribution'
import type { ClientDailyUsage, ClientUsageResponse } from '../../api/types'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function day(date: string, overrides: Partial<ClientDailyUsage> = {}): ClientDailyUsage {
  return {
    value: date, date, status: 'complete', request_count: 0, success_count: 0, error_count: 0, fallback_count: 0,
    input_tokens: 0, output_tokens: 0, cached_input_read_tokens: 0, cached_input_write_tokens: 0,
    cache_read_tokens: 0, cache_create_tokens: 0, total_tokens: 0, cost_usd: 0,
    provider_usage_count: 0, estimated_usage_count: 0, last_seen_at: '', ...overrides,
  }
}

const detail: ClientUsageResponse = {
  client: { name: 'office/key + east', token: '<redacted>', quota: { enabled: true, windows: [{ name: 'hourly', type: 'requests', duration: '1h', max_requests: 100 }] }, bindings: [{ inbound: 'openai-entry', inbound_protocol: 'openai_chat', inbound_path: '/v1/chat/completions', ref: 'office/key + east', tag: 'office' }, { inbound: 'anthropic-entry', inbound_protocol: 'anthropic_messages', inbound_path: '/v1/messages', ref: 'office/key + east', tag: 'shared' }] },
  all_time: day('office/key + east', { value: 'office/key + east', request_count: 99, total_tokens: 1000, error_count: 4, cost_usd: 2.5, last_seen_at: '2024-03-01T04:05:06Z' }),
  range_summary: day('office/key + east', { value: 'office/key + east', request_count: 16, success_count: 13, error_count: 3, fallback_count: 2, total_tokens: 180, cost_usd: 1.5, last_seen_at: '2024-03-01T04:05:06Z' }),
  quota: { client: 'office/key + east', inbound: 'openai-entry', enabled: true, state: 'available', windows: [{ name: 'hourly', type: 'requests', duration: '1h', max_requests: 100, used_requests: 10, remaining_requests: 90 }] },
  coverage: { tracking_started_at: '2023-12-30T12:00:00Z', known: true, backend: 'snapshot', aggregates_persisted: true, raw_retention_days: 30 },
  start_date: '2023-12-30', end_date: '2024-03-03',
  daily: [
    day('2023-12-30', { request_count: 1, success_count: 1, total_tokens: 10, cost_usd: 0.1, last_seen_at: '2023-12-30T03:00:00Z' }),
    day('2024-02-29', { request_count: 5, success_count: 3, error_count: 2, fallback_count: 1, input_tokens: 20, output_tokens: 10, cache_read_tokens: 4, cache_create_tokens: 3, total_tokens: 37, cost_usd: 0.5, last_seen_at: '2024-02-29T23:59:00Z' }),
    day('2024-03-01', { status: 'partial', request_count: 10, success_count: 9, error_count: 1, fallback_count: 1, input_tokens: 100, output_tokens: 30, cache_read_tokens: 20, cache_create_tokens: 10, total_tokens: 160, cost_usd: 1, last_seen_at: '2024-03-01T04:05:06Z' }),
    day('2024-03-02', { status: 'unknown' }),
  ],
}

function renderPage(path = '/clients/office%2Fkey%20%2B%20east') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><Routes><Route path="/clients/:name" element={<ClientDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  fetchMock.mockReset()
})

describe('ClientDetailPage', () => {
  it('uses the decoded route name and sends only the URLSearchParams-encoded default request', async () => {
    fetchMock.mockResolvedValue(response(detail))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'office/key + east' })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(String(fetchMock.mock.calls[0][0])).toBe('/admin/config/client/usage?name=office%2Fkey+%2B+east')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('start_date')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('end_date')
    expect(screen.getByText('16')).toBeInTheDocument()
    expect(screen.getByText('18.75% error rate')).toBeInTheDocument()
    expect(screen.getAllByText('3', { selector: '.metric-card strong' })).toHaveLength(2)
    expect(screen.getByText(/10 used · 90 remaining/)).toBeInTheDocument()
    expect(screen.getByText('Bindings (2)')).toBeInTheDocument()
    expect(screen.getByText('anthropic-entry')).toBeInTheDocument()
    expect(screen.getByText('/v1/messages')).toBeInTheDocument()
  })

  it('renders request, token, and cost quota metrics with unpriced warnings', async () => {
    fetchMock.mockResolvedValue(response({ ...detail, quota: { ...detail.quota!, windows: [
      { name: 'legacy', duration: '1h', max_requests: 100, used_requests: 10, remaining_requests: 90 },
      { name: 'tokens', type: 'tokens', duration: '24h', max_tokens: 10000, used_tokens: 1200, remaining_tokens: 8800, reset_at: '2024-03-02T00:00:00Z' },
      { name: 'budget', type: 'cost', duration: '168h', max_cost_usd: 5.5, used_cost_usd: 1.234567, remaining_cost_usd: 4.265433, unpriced_count: 2, warning: 'pricing missing' },
    ] } }))
    renderPage()
    expect(await screen.findByText(/10 used · 90 remaining \/ 100 requests/)).toBeInTheDocument()
    expect(screen.getByText(/1,200 used · 8,800 remaining \/ 10,000 tokens/)).toBeInTheDocument()
    expect(screen.getByText(/\$1\.234567 used · \$4\.265433 remaining \/ \$5\.50 USD/)).toBeInTheDocument()
    expect(screen.getByText('Duration: 24h')).toBeInTheDocument()
    expect(screen.getByText('Resets 2024-03-02T00:00:00Z')).toBeInTheDocument()
    expect(screen.getByText('Unpriced usage')).toBeInTheDocument()
    expect(screen.getByText(/2 successful terminal requests were counted as \$0\. pricing missing/)).toBeInTheDocument()
    expect(screen.getByText(/may overshoot with current or concurrent requests/)).toBeInTheDocument()
  })

  it('renders an unbound client without assuming an inbound or tag', async () => {
    fetchMock.mockResolvedValue(response({ ...detail, client: { ...detail.client, bindings: [] } }))
    renderPage()
    expect(await screen.findByText('Bindings (0)')).toBeInTheDocument()
    expect(screen.getByText('This client is not bound to any inbound.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'office/key + east' })).toBeInTheDocument()
  })

  it('lays out cross-year leap-day data in Sunday-Saturday week columns with placeholders', async () => {
    fetchMock.mockResolvedValue(response(detail))
    const { container } = renderPage()
    await screen.findByRole('button', { name: /2024-02-29/ })
    const leap = container.querySelector('[data-date="2024-02-29"]') as HTMLElement
    expect(leap).toHaveAttribute('data-weekday', '4')
    const newYear = container.querySelector('button[data-date="2024-01-01"]') as HTMLElement
    expect(newYear).toHaveAttribute('data-weekday', '1')
    expect(container.querySelector('.heatmap-placeholder[data-date="2023-12-24"]')).toBeInTheDocument()
    expect(container.querySelector('.heatmap-placeholder[data-date="2024-03-02"]')).not.toBeInTheDocument()
    expect(screen.getByText('Dec 2023')).toBeInTheDocument()
    expect(screen.getByText('Jan 2024')).toBeInTheDocument()
    expect(screen.getByText('Feb')).toBeInTheDocument()
  })

  it('maps zero and log1p values for all four metrics and always assigns max level 4', async () => {
    expect(contributionLevel(0, 100)).toBe(0)
    expect(contributionLevel(1, 100)).toBe(1)
    expect(contributionLevel(100, 100)).toBe(4)
    fetchMock.mockResolvedValue(response(detail))
    const { container } = renderPage()
    await screen.findByRole('button', { name: /2024-03-01/ })
    const target = () => container.querySelector('button[data-date="2024-03-01"]') as HTMLElement
    expect(target()).toHaveAttribute('data-level', '4')
    fireEvent.click(screen.getByLabelText('Tokens'))
    expect(target()).toHaveAttribute('data-level', '4')
    fireEvent.click(screen.getByLabelText('Cost'))
    expect(target()).toHaveAttribute('data-level', '4')
    fireEvent.click(screen.getByLabelText('Errors'))
    expect((container.querySelector('button[data-date="2024-02-29"]') as HTMLElement)).toHaveAttribute('data-level', '4')
    expect((container.querySelector('button[data-date="2024-03-02"]') as HTMLElement)).toHaveAttribute('data-level', '0')
  })

  it('renders partial and unknown semantics and a complete focus popover without title', async () => {
    fetchMock.mockResolvedValue(response(detail))
    renderPage()
    const partial = await screen.findByRole('button', { name: '2024-03-01, 10 requests, partial coverage' })
    const unknown = screen.getByRole('button', { name: '2024-03-02, 0 requests, unknown coverage' })
    expect(partial).toHaveClass('heatmap-status-partial')
    expect(unknown).toHaveClass('heatmap-status-unknown')
    expect(partial).not.toHaveAttribute('title')
    partial.focus()
    expect(partial).toHaveFocus()
    const tooltip = await screen.findByRole('tooltip')
    expect(within(tooltip).getByText('2024-03-01 UTC')).toBeInTheDocument()
    ;['Status: partial', 'Requests: 10', 'Successes: 9', 'Errors: 1', 'Fallbacks: 1', 'Input tokens: 100', 'Output tokens: 30', 'Cache read: 20', 'Cache create: 10', 'Total tokens: 160', 'Cost: $1.0000', 'Last seen: 2024-03-01T04:05:06Z'].forEach((text) => expect(within(tooltip).getByText(text)).toBeInTheDocument())
    expect(partial).toHaveAttribute('aria-describedby', 'usage-day-2024-03-01')
  })

  it('sorts daily rows newest first', async () => {
    fetchMock.mockResolvedValue(response({ ...detail, daily: [detail.daily[0], detail.daily[3], detail.daily[1], detail.daily[2]] }))
    renderPage()
    const table = await screen.findByRole('table')
    const dates = within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
    expect(dates).toEqual(['2024-03-02', '2024-03-01', '2024-02-29', '2023-12-30'])
  })

  it('shows distinct loading, refresh, 404, and general error states', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>((done) => { resolve = done }))
    const first = renderPage()
    expect(screen.getByText('Loading client usage')).toBeInTheDocument()
    first.unmount()
    resolve(response(detail))
    cleanup()

    fetchMock.mockResolvedValueOnce(response({ error: 'client not found' }, 404))
    renderPage()
    expect(await screen.findByText('404 · Client not found')).toBeInTheDocument()
    cleanup()

    fetchMock.mockResolvedValueOnce(response({ error: 'backend offline' }, 503)).mockResolvedValueOnce(response(detail))
    renderPage()
    expect(await screen.findByText('Client usage unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'office/key + east' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3))
  })
})

describe('buildContributionWeeks', () => {
  it('keeps every week as seven Sunday-Saturday cells through a leap year', () => {
    const weeks = buildContributionWeeks('2023-12-30', '2024-03-03', detail.daily)
    expect(weeks.every((week) => week.cells.length === 7)).toBe(true)
    expect(weeks[0].cells[0].date).toBe('2023-12-24')
    expect(weeks.at(-1)?.cells[6].date).toBe('2024-03-02')
    expect(weeks.flatMap((week) => week.cells).some((cell) => cell.date === '2024-02-29')).toBe(true)
  })
})
