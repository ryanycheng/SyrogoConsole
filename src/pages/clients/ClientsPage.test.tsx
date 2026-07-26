import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedbackProvider } from '../../app/feedback'
import { ClientsPage } from './ClientsPage'
import type { ClientResource } from '../../api/types'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const client: ClientResource = {
  name: 'office-key', token: '<redacted>',
  quota: { enabled: true, windows: [{ name: 'hourly', type: 'requests', duration: '1h', max_requests: 100 }] },
  bindings: [{ inbound: 'openai-entry', inbound_protocol: 'openai_chat', inbound_path: '/v1/chat/completions', ref: 'office-key', tag: 'office' }],
}

const metric = {
  client,
  all_time: { value: 'office-key', request_count: 12, total_tokens: 320, cost_usd: 1.25 },
  frequency: { requests: 7, active_days: 3, calendar_days: 30, requests_per_day: 0.2333, requests_per_active_day: 2.333 },
  quota: { client: 'office-key', inbound: 'openai-entry', enabled: true, state: 'available', windows: [{ name: 'hourly', type: 'requests', duration: '1h', max_requests: 100, used_requests: 10, remaining_requests: 90 }] },
}

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockInitial(metricsBody: object = { items: [metric], days: 30, start_date: '2026-06-24', end_date: '2026-07-24' }) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/metrics')) return Promise.resolve(response(metricsBody))
    if (url.endsWith('/admin/config/options')) return Promise.resolve(response({ inbounds: [{ name: 'openai-entry', protocol: 'openai_chat', path: '/v1/chat/completions', clients: [{ ref: 'office-key', tag: 'office' }] }, { name: 'anthropic-entry', protocol: 'anthropic_messages', path: '/v1/messages', clients: [] }] }))
    if (url.endsWith('/admin/config/clients')) return Promise.resolve(response({ items: [client] }))
    return Promise.resolve(response({ ok: true, applied: true }))
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<MemoryRouter><FeedbackProvider><QueryClientProvider client={queryClient}><ClientsPage /></QueryClientProvider></FeedbackProvider></MemoryRouter>)
}

function requestPath(call: number) { return String(fetchMock.mock.calls[call][0]) }
function requestBody(call: number) { return JSON.parse(String(fetchMock.mock.calls[call][1]?.body || '{}')) }
function countRequests(fragment: string) { return fetchMock.mock.calls.filter(([input]) => String(input).includes(fragment)).length }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

async function selectOption(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label))
  fireEvent.click(await screen.findByText(option))
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

describe('ClientsPage', () => {
  it('loads configuration and metrics independently, renders Core metric fields, links details, searches, filters, and changes frequency days', async () => {
    mockInitial()
    renderPage()

    const name = await screen.findByRole('link', { name: 'office-key' })
    expect(name).toHaveAttribute('href', '/clients/office-key')
    const row = name.closest('tr') as HTMLElement
    expect(row).toHaveTextContent('openai-entry')
    expect(row).toHaveTextContent('openai_chat')
    expect(row).toHaveTextContent('Requests: 12')
    expect(row).toHaveTextContent('Tokens: 320')
    expect(row).toHaveTextContent('Requests: 7')
    expect(row).toHaveTextContent('Active days: 3 / 30')
    expect(row).toHaveTextContent('10 used · 90 remaining / 100 requests')
    expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/metrics?days=30'))).toBe(true)

    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'anthropic' } })
    expect(screen.queryByRole('link', { name: 'office-key' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'openai_chat' } })
    expect(screen.getByRole('link', { name: 'office-key' })).toBeInTheDocument()
    await selectOption('Quota filter', 'Quota disabled')
    expect(screen.queryByRole('link', { name: 'office-key' })).not.toBeInTheDocument()
    await selectOption('Quota filter', 'Quota enabled')
    await selectOption('Frequency range', 'Last 7 days')
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/metrics?days=7'))).toBe(true))
  })

  it('renders token and cost metrics plus an unpriced warning in the list', async () => {
    const typedMetric = { ...metric, quota: { ...metric.quota, windows: [
      { name: 'tokens', type: 'tokens', duration: '24h', max_tokens: 5000, used_tokens: 1200, remaining_tokens: 3800 },
      { name: 'budget', type: 'cost', duration: '168h', max_cost_usd: 5, used_cost_usd: 1.25, remaining_cost_usd: 3.75, unpriced_count: 1, warning: 'pricing unavailable' },
    ] } }
    mockInitial({ items: [typedMetric], days: 30, start_date: '', end_date: '' })
    renderPage()
    const row = (await screen.findByRole('link', { name: 'office-key' })).closest('tr') as HTMLElement
    expect(row).toHaveTextContent('1,200 used · 3,800 remaining / 5,000 tokens')
    expect(row).toHaveTextContent('$1.25 used · $3.75 remaining / $5.00 USD')
    expect(within(row).getByText('Unpriced usage')).toBeInTheDocument()
    expect(row).toHaveTextContent('1 successful terminal request was counted as $0. pricing unavailable')
  })

  it('keeps CRUD available when metrics fail and sends a strict new-client payload', async () => {
    mockInitial({ error: 'metrics offline' })
    const original = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/metrics')) return Promise.resolve(response({ error: 'metrics offline' }, 503))
      return original!(input, init)
    })
    renderPage()

    expect(await screen.findByText('Runtime metrics unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'mobile-key' } })
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText('Enable quota'))
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }))
    fireEvent.change(screen.getByLabelText('Window 1 name'), { target: { value: 'hourly' } })
    fireEvent.change(screen.getByLabelText('Window 1 max requests'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(countRequests('/client/upsert')).toBe(1))
    const index = fetchMock.mock.calls.findIndex((_, call) => requestPath(call).includes('/client/upsert'))
    expect(requestBody(index)).toEqual({ name: 'mobile-key', token: 'secret', quota: { enabled: true, windows: [{ name: 'hourly', type: 'requests', duration: '1h', max_requests: 50 }] } })
  })

  it('sends strict token and cost payloads, clears limits when switching type, and validates each limit', async () => {
    mockInitial()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'typed-client' } })
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText('Enable quota'))
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }))
    fireEvent.change(screen.getByLabelText('Window 1 name'), { target: { value: 'typed' } })

    fireEvent.click(screen.getByLabelText('Window 1 type'))
    const tokenOption = await screen.findByText('Tokens')
    expect(screen.getByRole('dialog', { name: 'New client' })).toContainElement(tokenOption.closest('.arco-select-popup') as HTMLElement)
    fireEvent.click(tokenOption)
    expect(screen.getByLabelText('Window 1 max tokens')).toHaveValue(null)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter a positive integer.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Window 1 max tokens'), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(countRequests('/client/upsert')).toBe(1))
    let index = fetchMock.mock.calls.findIndex((_, call) => requestPath(call).includes('/client/upsert'))
    expect(requestBody(index).quota.windows[0]).toEqual({ name: 'typed', type: 'tokens', duration: '1h', max_tokens: 1000 })

    cleanup()
    fetchMock.mockReset()
    mockInitial()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'cost-client' } })
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText('Enable quota'))
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }))
    fireEvent.change(screen.getByLabelText('Window 1 name'), { target: { value: 'budget' } })
    fireEvent.change(screen.getByLabelText('Window 1 max requests'), { target: { value: '25' } })
    await selectOption('Window 1 type', 'Cost')
    expect(screen.getByLabelText('Window 1 max cost (usd)')).toHaveValue(null)
    fireEvent.change(screen.getByLabelText('Window 1 max cost (usd)'), { target: { value: '1.1234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter a positive decimal with at most 6 decimal places.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Window 1 max cost (usd)'), { target: { value: '1.234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(countRequests('/client/upsert')).toBe(1))
    index = fetchMock.mock.calls.findIndex((_, call) => requestPath(call).includes('/client/upsert'))
    expect(requestBody(index).quota.windows[0]).toEqual({ name: 'budget', type: 'cost', duration: '1h', max_cost_usd: 1.234567 })
  })

  it('treats legacy quota responses without type as requests', async () => {
    const legacyClient = { ...client, quota: { enabled: true, windows: [{ name: 'legacy', duration: '1h', max_requests: 20 }] } }
    const legacyMetric = { ...metric, client: legacyClient, quota: { ...metric.quota, windows: [{ name: 'legacy', duration: '1h', limit: 20, used: 4, remaining: 16 }] } }
    mockInitial({ items: [legacyMetric], days: 30, start_date: '', end_date: '' })
    const original = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/admin/config/clients') ? Promise.resolve(response({ items: [legacyClient] })) : original!(input, init))
    renderPage()
    const row = (await screen.findByRole('link', { name: 'office-key' })).closest('tr') as HTMLElement
    expect(row).toHaveTextContent('4 used · 16 remaining / 20 requests')
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByLabelText('Window 1 type')).toHaveTextContent('Requests')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(countRequests('/client/upsert')).toBe(1))
    const index = fetchMock.mock.calls.findIndex((_, call) => requestPath(call).includes('/client/upsert'))
    expect(requestBody(index).quota.windows[0]).toEqual({ name: 'legacy', type: 'requests', duration: '1h', max_requests: 20 })
  })
  it('locks name while editing, preserves token with empty payload, and warns on quota reset', async () => {
    mockInitial()
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/metrics')) return Promise.resolve(response({ items: [metric], days: 30, start_date: '', end_date: '' }))
      if (url.endsWith('/admin/config/options')) return Promise.resolve(response({ inbounds: [{ name: 'openai-entry', protocol: 'openai_chat', path: '/v1/chat/completions', clients: [{ ref: 'office-key', tag: 'office' }] }, { name: 'anthropic-entry', protocol: 'anthropic_messages', path: '/v1/messages', clients: [] }] }))
    if (url.endsWith('/admin/config/clients')) return Promise.resolve(response({ items: [client] }))
      if (url.includes('/client/upsert')) return Promise.resolve(response({ ok: true, applied: true, quota_state_reset: true }))
      return Promise.resolve(response({ ok: true, applied: true }))
    })
    renderPage()
    const row = (await screen.findByRole('link', { name: 'office-key' })).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByLabelText('Name')).toBeDisabled()
    expect(screen.queryByLabelText('Inbound')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tag')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Token')).toHaveValue('')
    fireEvent.click(screen.getByText('Enable quota'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(countRequests('/client/upsert')).toBe(1))
    const index = fetchMock.mock.calls.findIndex((_, call) => requestPath(call).includes('/client/upsert'))
    expect(requestBody(index)).toEqual({ name: 'office-key', token: '', quota: { enabled: false, windows: client.quota.windows } })
    expect(await screen.findByText('Client quota counters were reset while applying this change.')).toBeInTheDocument()
  })

  it('validates Go durations, shows previews, disallows d, and confirms dirty cancellation', async () => {
    mockInitial()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'draft-client' } })
    fireEvent.click(screen.getByText('Enable quota'))
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }))
    expect(screen.getByRole('button', { name: '168h' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Window 1 duration'), { target: { value: '1h30m' } })
    expect(screen.getByText(/1 hour 30 minutes/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Window 1 duration'), { target: { value: '1d' } })
    expect(screen.getByText(/d is not supported/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard unsaved client changes?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('dialog', { name: 'New client' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Discard unsaved client changes?' })).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog', { name: 'New client' })).not.toBeInTheDocument()
  })

  it('copies the verified 30-second idle refresh boundary without refreshing early', async () => {
    vi.useFakeTimers()
    mockInitial()
    renderPage()
    await advance(0)
    expect(screen.getByRole('link', { name: 'office-key' })).toBeInTheDocument()
    expect(countRequests('/admin/config/clients')).toBe(2)

    await advance(29_000)
    expect(countRequests('/admin/config/clients')).toBe(2)
    await advance(1_000)
    expect(countRequests('/admin/config/clients')).toBe(4)
    vi.useRealTimers()
  })

  it('adds, edits, and deletes bindings with the client ref supplied automatically', async () => {
    mockInitial()
    renderPage()
    const row = (await screen.findByRole('link', { name: 'office-key' })).closest('tr') as HTMLElement

    fireEvent.click(within(row).getByRole('button', { name: 'Add binding' }))
    fireEvent.click(screen.getByLabelText('Binding inbound'))
    const popupOption = await screen.findByText('anthropic-entry (anthropic_messages) · /v1/messages')
    expect(screen.getByRole('dialog', { name: 'Add binding: office-key' })).toContainElement(popupOption.closest('.arco-select-popup') as HTMLElement)
    fireEvent.click(popupOption)
    expect(screen.getByLabelText('Binding inbound')).toHaveTextContent('anthropic-entry')
    fireEvent.change(screen.getByLabelText('Binding tag'), { target: { value: 'mobile' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save binding' }))
    await waitFor(() => expect(countRequests('/client-binding/upsert')).toBe(1))
    let index = fetchMock.mock.calls.findIndex((_, call) => requestPath(call).includes('/client-binding/upsert'))
    expect(requestBody(index)).toEqual({ inbound: 'anthropic-entry', ref: 'office-key', tag: 'mobile' })

    fireEvent.click(within(row).getByRole('button', { name: 'Edit binding openai-entry' }))
    expect(await screen.findByLabelText('Binding inbound')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(screen.getByLabelText('Binding tag'), { target: { value: 'shared' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save binding' }))
    await waitFor(() => expect(countRequests('/client-binding/upsert')).toBe(2))
    index = fetchMock.mock.calls.findLastIndex((_, call) => requestPath(call).includes('/client-binding/upsert'))
    expect(requestBody(index)).toEqual({ inbound: 'openai-entry', ref: 'office-key', tag: 'shared' })

    fireEvent.click(within(row).getByRole('button', { name: 'Delete binding openai-entry' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Delete binding from openai-entry?' })).getByRole('button', { name: 'Delete binding' }))
    await waitFor(() => expect(countRequests('/client-binding/delete')).toBe(1))
    index = fetchMock.mock.calls.findIndex((_, call) => requestPath(call).includes('/client-binding/delete'))
    expect(requestBody(index)).toEqual({ inbound: 'openai-entry', ref: 'office-key' })
  })

  it('shows an explicit empty state when no inbound can be added', async () => {
    mockInitial()
    const original = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/admin/config/options')) return Promise.resolve(response({ inbounds: [{ name: 'openai-entry', protocol: 'openai_chat', path: '/v1/chat/completions', clients: [{ ref: 'office-key', tag: 'office' }] }] }))
      return original!(input, init)
    })
    renderPage()
    const row = (await screen.findByRole('link', { name: 'office-key' })).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Add binding' }))
    expect(await screen.findByText('No inbound available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save binding' })).toBeDisabled()
  })

  it('keeps the binding dialog open and explains structured last-source failures', async () => {
    mockInitial()
    const original = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/client-binding/delete')) return Promise.resolve(response({ error: 'binding is still required', error_code: 'binding_tag_last_source', details: { operation: 'delete', client: 'office-key', inbound: 'openai-entry', tag: 'office', route_names: ['default-route', 'fallback-route'] } }, 409))
      return original!(input, init)
    })
    renderPage()
    const row = (await screen.findByRole('link', { name: 'office-key' })).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Delete binding openai-entry' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete binding from openai-entry?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete binding' }))

    expect(await within(dialog).findByText('This binding is the last source for a route tag')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('default-route')
    expect(dialog).toHaveTextContent('fallback-route')
    expect(dialog).toHaveTextContent('Add another binding with tag office')
    expect(dialog).toHaveTextContent('First update each route’s from_tags')
    expect(screen.getByRole('dialog', { name: 'Delete binding from openai-entry?' })).toBeInTheDocument()
  })

  it('disables client deletion until all bindings are removed', async () => {
    mockInitial()
    renderPage()
    const row = (await screen.findByRole('link', { name: 'office-key' })).closest('tr') as HTMLElement
    const button = within(row).getByRole('button', { name: 'Delete' })
    expect(button).toBeDisabled()
    expect(within(row).getByText('Unbind first to delete')).toBeInTheDocument()
  })

  it('renders safely while an older Core response omits bindings', async () => {
    mockInitial()
    const legacyClient = { name: client.name, token: client.token, quota: client.quota }
    const original = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/admin/config/clients')) return Promise.resolve(response({ items: [legacyClient] }))
      return original!(input, init)
    })
    renderPage()

    const row = (await screen.findByRole('link', { name: 'office-key' })).closest('tr') as HTMLElement
    expect(within(row).getByText('No bindings')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('requires the complete client name for an unbound client and sends only its name', async () => {
    const unbound = { ...client, bindings: [] }
    mockInitial({ ...metric, client: unbound })
    const original = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/admin/config/clients')) return Promise.resolve(response({ items: [unbound] }))
      return original!(input, init)
    })
    renderPage()
    const row = (await screen.findByRole('link', { name: 'office-key' })).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Permanently delete office-key?' })
    const button = within(dialog).getByRole('button', { name: 'Delete' })
    expect(button).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Confirm client name'), { target: { value: 'office' } })
    expect(button).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Confirm client name'), { target: { value: 'office-key' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(countRequests('/client/delete')).toBe(1))
    const index = fetchMock.mock.calls.findIndex((_, call) => requestPath(call).includes('/client/delete'))
    expect(requestBody(index)).toEqual({ name: 'office-key' })
  })
})
