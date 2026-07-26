import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedbackProvider } from '../../app/feedback'
import { ProvidersPage } from './ProvidersPage'
import type { ProviderResource } from '../../api/types'

const fetchMock = vi.fn()
const react19RefWarning = 'Accessing element.ref was removed in React 19'
vi.stubGlobal('fetch', fetchMock)

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const provider: ProviderResource = {
  name: 'openai-main', models: [{ name: 'gpt-main', aliases: ['gpt-alias'] }], protocol: 'openai_chat', endpoint: 'https://api.example/v1', auth_token: '<redacted>', tag: 'primary', enabled: true,
  capabilities: {
    responses_previous_response_id: null, responses_builtin_tools: null, responses_tool_result_status_error: null,
    responses_assistant_history_native: null, usage_estimation: true, usage_estimation_mode: 'heuristic',
  },
  quota: { enabled: true, windows: [{ name: 'hourly', duration: '1h', max_requests: 100 }], cooldown: '1m', probe_interval: '30s', reset_all: { enabled: false, schedule: { period: 'daily', time: '00:00', timezone: 'UTC' } } },
  proxy: { url: '' },
}

const metric = {
  provider,
  usage: { value: 'openai-main', request_count: 12, error_count: 2, cost_usd: 1.25 },
  health: { outbound: 'openai-main', state: 'available', last_success_at: '', last_failure_at: '', consecutive_failures: 0 },
  quota: { outbound: 'openai-main', enabled: true, state: 'available', next_probe_at: '', last_success_at: '', windows: [{ name: 'hourly', duration: '1h', limit: 100, used: 10, remaining: 90, reset_at: '' }] },
  timeline: [{ start: '2026-07-23T00:00:00Z', end: '2026-07-23T00:10:00Z', request_count: 1, success_count: 1, error_count: 0, state: 'success' }],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<FeedbackProvider><QueryClientProvider client={client}><ProvidersPage /></QueryClientProvider></FeedbackProvider>)
}

function requestPath(call: number) {
  return String(fetchMock.mock.calls[call][0])
}

function requestBody(call: number) {
  return JSON.parse(String(fetchMock.mock.calls[call][1]?.body || '{}'))
}

function mockInitial(metricsBody: object = { items: [metric], hours: 6, bucket_minutes: 10, bucket_count: 36 }, configuredProvider: ProviderResource = provider) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/metrics')) return Promise.resolve(response(metricsBody))
    if (url.endsWith('/admin/config/providers')) return Promise.resolve(response({ items: [configuredProvider] }))
    return Promise.resolve(response({ ok: true }))
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

function countRequests(fragment: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(fragment)).length
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe('ProvidersPage', () => {
  it('loads config and metrics independently, merges by provider name, filters, and changes hours', async () => {
    mockInitial()
    renderPage()

    expect(await screen.findByText('openai-main')).toBeInTheDocument()
    const row = screen.getByText('openai-main').closest('tr') as HTMLElement
    expect(row).toHaveTextContent('Requests: 12')
    expect(row).toHaveTextContent('Tokens: 0')
    expect(row).toHaveTextContent('Cost: $1.2500')
    expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/metrics?hours=6'))).toBe(true)

    fireEvent.change(screen.getByLabelText('Search providers'), { target: { value: 'missing' } })
    expect(screen.queryByText('openai-main')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search providers'), { target: { value: 'api.example' } })
    expect(screen.getByText('openai-main')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Timeline range'))
    fireEvent.click(await screen.findByText('Last 24h'))
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/metrics?hours=24'))).toBe(true))
  })

  it('keeps CRUD available when metrics fail and saves a valid draft with pending Apply', async () => {
    mockInitial({ error: 'metrics offline' })
    const original = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/metrics')) return Promise.resolve(response({ error: 'metrics offline' }, 503))
      if (url.includes('/provider/upsert')) return Promise.resolve(response({ ok: true }))
      return original!(input, init)
    })
    renderPage()

    expect(await screen.findByText('Runtime metrics unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'new-provider' } })
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'new-tag' } })
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://new.example/v1' } })
    fireEvent.change(screen.getByLabelText('Auth token'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/upsert'))).toBe(true))
    const index = fetchMock.mock.calls.findIndex((_, callIndex) => requestPath(callIndex).includes('/provider/upsert'))
    expect(requestBody(index)).toMatchObject({ name: 'new-provider', protocol: 'openai_chat', tag: 'new-tag', auth_token: 'secret' })
    expect(screen.queryByRole('button', { name: 'Apply external changes' })).not.toBeInTheDocument()
  })

  it.each(['<redacted>', ''])('preserves an existing auth token when editing with %j', async (authToken) => {
    mockInitial()
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const token = await screen.findByLabelText('Auth token')
    fireEvent.change(token, { target: { value: authToken } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/upsert'))).toBe(true))
    const index = fetchMock.mock.calls.findIndex((_, callIndex) => requestPath(callIndex).includes('/provider/upsert'))
    expect(requestBody(index).auth_token).toBe(authToken)
  })

  it('clears incompatible capabilities when switching protocols', async () => {
    const responsesProvider: ProviderResource = {
      ...provider,
      protocol: 'openai_responses',
      capabilities: {
        responses_previous_response_id: true,
        responses_builtin_tools: false,
        responses_tool_result_status_error: true,
        responses_assistant_history_native: false,
        usage_estimation: false,
        usage_estimation_mode: '',
      },
    }
    mockInitial({ items: [], hours: 6, bucket_minutes: 10, bucket_count: 36 }, responsesProvider)
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))

    fireEvent.click(await screen.findByLabelText('Protocol'))
    fireEvent.click(await screen.findByText('anthropic_messages'))
    expect(screen.queryByText('Previous response ID')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Usage estimation'))
    fireEvent.click(screen.getByLabelText('Protocol'))
    fireEvent.click(await screen.findByText('mock'))
    expect(screen.queryByText('Usage estimation')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/upsert'))).toBe(true))
    const index = fetchMock.mock.calls.findIndex((_, callIndex) => requestPath(callIndex).includes('/provider/upsert'))
    expect(requestBody(index).capabilities).toEqual({
      responses_previous_response_id: null,
      responses_builtin_tools: null,
      responses_tool_result_status_error: null,
      responses_assistant_history_native: null,
      usage_estimation: false,
      usage_estimation_mode: '',
    })
  })

  it('preserves an unknown future usage estimation mode when saving unchanged', async () => {
    const futureProvider = { ...provider, capabilities: { ...provider.capabilities, usage_estimation: true, usage_estimation_mode: 'future_precise' } }
    mockInitial({ items: [], hours: 6, bucket_minutes: 10, bucket_count: 36 }, futureProvider)
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText(/Unknown future modes are preserved/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/upsert'))).toBe(true))
    const index = fetchMock.mock.calls.findIndex((_, callIndex) => requestPath(callIndex).includes('/provider/upsert'))
    expect(requestBody(index).capabilities).toMatchObject({ usage_estimation: true, usage_estimation_mode: 'future_precise' })
  })

  it('round-trips rolling and all fixed quota periods, three limit combinations, and reset-all snake_case', async () => {
    const quotaProvider: ProviderResource = {
      ...provider,
      quota: {
        enabled: true,
        cooldown: '2m',
        probe_interval: '45s',
        windows: [
          { name: 'rolling-requests', reset: 'rolling', duration: '1h', max_requests: 10 },
          { name: 'fixed-tokens', reset: 'fixed', duration: '5h', fixed: { period: 'interval', anchor: '2026-07-23T08:00:00+08:00' }, max_tokens: 5000 },
          { name: 'daily-both', reset: 'fixed', fixed: { period: 'daily', time: '09:30', timezone: 'Asia/Shanghai' }, max_requests: 20, max_tokens: 8000 },
          { name: 'weekly-requests', reset: 'fixed', fixed: { period: 'weekly', time: '10:00:30', timezone: 'UTC', weekday: 1 }, max_requests: 100 },
        ],
        reset_all: { enabled: true, schedule: { period: 'weekly', time: '00:00', timezone: 'UTC', weekday: 0 } },
      },
    }
    mockInitial({ items: [], hours: 6, bucket_minutes: 10, bucket_count: 36 }, quotaProvider)
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByLabelText('Window 2 anchor')).toHaveValue('2026-07-23T08:00:00+08:00')
    expect(screen.getByLabelText('Window 3 timezone')).toHaveValue('Asia/Shanghai')
    expect(screen.getByLabelText('Window 4 weekday')).toBeInTheDocument()
    expect(screen.getByText(/weekly reset can clear daily and 5h counters/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/upsert'))).toBe(true))
    const index = fetchMock.mock.calls.findIndex((_, callIndex) => requestPath(callIndex).includes('/provider/upsert'))
    expect(requestBody(index).quota).toEqual(quotaProvider.quota)
  })

  it('clears incompatible quota scheduling fields when reset and fixed period change', async () => {
    const fixedProvider: ProviderResource = {
      ...provider,
      quota: { ...provider.quota, windows: [{ name: 'weekly', reset: 'fixed', fixed: { period: 'weekly', time: '08:00', timezone: 'UTC', weekday: 2 }, max_requests: 5 }] },
    }
    mockInitial({ items: [], hours: 6, bucket_minutes: 10, bucket_count: 36 }, fixedProvider)
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByLabelText('Window 1 fixed period'))
    fireEvent.click(await screen.findByText('daily'))
    expect(screen.queryByLabelText('Window 1 weekday')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Window 1 reset'))
    fireEvent.click(await screen.findByText('rolling'))
    expect(screen.queryByLabelText('Window 1 fixed period')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Window 1 duration')).toHaveValue('1h')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/upsert'))).toBe(true))
    const index = fetchMock.mock.calls.findIndex((_, callIndex) => requestPath(callIndex).includes('/provider/upsert'))
    expect(requestBody(index).quota.windows[0]).toEqual({ name: 'weekly', reset: 'rolling', duration: '1h', max_requests: 5 })
  })

  it('renders request and token quota metrics with units and legacy alias fallback', async () => {
    const dualMetric = {
      ...metric,
      quota: { ...metric.quota, windows: [
        { name: 'dual', reset: 'fixed', fixed_period: 'daily', max_requests: 100, used_requests: 25, remaining_requests: 75, max_tokens: 10000, used_tokens: 2500, remaining_tokens: 7500, reset_at: '2026-07-24T00:00:00Z' },
        { name: 'legacy', duration: '1h', limit: 20, used: 3, remaining: 17, reset_at: '' },
      ] },
    }
    mockInitial({ items: [dualMetric], hours: 6, bucket_minutes: 10, bucket_count: 36 })
    renderPage()
    expect(await screen.findByText(/25 used · 75 remaining \/ 100 requests/)).toBeInTheDocument()
    expect(screen.getByText(/2,500 used · 7,500 remaining \/ 10,000 tokens/)).toBeInTheDocument()
    expect(screen.getByText(/3 used · 17 remaining \/ 20 requests/)).toBeInTheDocument()
    expect(screen.getByText(/Resets: 2026-07-24/)).toBeInTheDocument()
  })

  it('sends complete snake_case capabilities, quota, and proxy payloads', async () => {
    mockInitial()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'complete-provider' } })
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'complete' } })
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://complete.example/v1' } })
    fireEvent.change(screen.getByLabelText('Auth token'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByLabelText('Usage estimation'))
    fireEvent.click(screen.getByText('Enable quota'))
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }))
    fireEvent.change(screen.getByLabelText('Window 1 name'), { target: { value: 'hourly' } })
    fireEvent.change(screen.getByLabelText('Window 1 max requests'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Probe interval'), { target: { value: '30s' } })
    fireEvent.change(screen.getByLabelText('Proxy URL'), { target: { value: 'socks5://proxy.example:1080' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/upsert'))).toBe(true))
    const index = fetchMock.mock.calls.findIndex((_, callIndex) => requestPath(callIndex).includes('/provider/upsert'))
    expect(requestBody(index)).toEqual({
      name: 'complete-provider',
      models: [],
      protocol: 'openai_chat',
      endpoint: 'https://complete.example/v1',
      auth_token: 'secret',
      tag: 'complete',
      enabled: true,
      capabilities: {
        responses_previous_response_id: null,
        responses_builtin_tools: null,
        responses_tool_result_status_error: null,
        responses_assistant_history_native: null,
        usage_estimation: true,
        usage_estimation_mode: 'heuristic',
      },
      quota: { enabled: true, windows: [{ name: 'hourly', reset: 'rolling', duration: '1h', max_requests: 100 }], cooldown: '1m', probe_interval: '30s', reset_all: { enabled: false, schedule: { period: 'daily', time: '00:00', timezone: 'UTC' } } },
      proxy: { url: 'socks5://proxy.example:1080' },
    })
  })

  it('validates quota and proxy fields before saving', async () => {
    mockInitial()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'invalid-provider' } })
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'invalid' } })
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://invalid.example/v1' } })
    fireEvent.change(screen.getByLabelText('Auth token'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText('Enable quota'))
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }))
    fireEvent.change(screen.getByLabelText('Window 1 duration'), { target: { value: '0s' } })
    fireEvent.change(screen.getByLabelText('Window 1 max requests'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('Cooldown'), { target: { value: 'later' } })
    fireEvent.change(screen.getByLabelText('Proxy URL'), { target: { value: 'ftp://proxy.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findAllByText('Enter a positive Go duration.')).toHaveLength(2)
    expect(screen.getByText('Set at least one positive request or token limit.')).toBeInTheDocument()
    expect(screen.getByText('Use an http, https, or socks5 URL with a host.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/upsert'))).toBe(false)
  })

  it('validates a draft test model and sends the complete provider with an explicit model', async () => {
    mockInitial()
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/metrics')) return Promise.resolve(response({ items: [], hours: 6, bucket_minutes: 10, bucket_count: 36 }))
      if (url.endsWith('/admin/config/providers')) return Promise.resolve(response({ items: [provider] }))
      if (url.includes('/provider/check')) return Promise.resolve(response({ error: 'draft upstream rejected the model' }, 400))
      return Promise.resolve(response({ ok: true }))
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'draft-provider' } })
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'draft' } })
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://draft.example/v1' } })
    fireEvent.change(screen.getByLabelText('Auth token'), { target: { value: 'draft-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test draft' }))
    expect(await screen.findByText('Test model is required for non-mock providers.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/check'))).toBe(false)
    fireEvent.change(screen.getByLabelText('Test model'), { target: { value: 'draft-model' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test draft' }))

    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/check'))).toBe(true))
    const index = fetchMock.mock.calls.findIndex((_, callIndex) => requestPath(callIndex).includes('/provider/check'))
    expect(requestBody(index)).toEqual(expect.objectContaining({
      name: 'draft-provider',
      model: 'draft-model',
      provider: expect.objectContaining({ name: 'draft-provider', protocol: 'openai_chat', auth_token: 'draft-secret' }),
    }))
    expect(await screen.findByText('Test failed')).toBeInTheDocument()
    expect(screen.getByText('draft upstream rejected the model')).toBeInTheDocument()
  })

  it('allows an empty test model for a mock draft', async () => {
    mockInitial()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'mock-draft' } })
    fireEvent.click(screen.getByLabelText('Protocol'))
    fireEvent.click(await screen.findByText('mock'))
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'mock' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test draft' }))

    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/check'))).toBe(true))
    const index = fetchMock.mock.calls.findIndex((_, callIndex) => requestPath(callIndex).includes('/provider/check'))
    expect(requestBody(index)).toEqual(expect.objectContaining({
      name: 'mock-draft', model: '', provider: expect.objectContaining({ name: 'mock-draft', protocol: 'mock' }),
    }))
  })

  it('opens a saved provider test modal, validates model, sends it, and keeps failures visible', async () => {
    mockInitial()
    const original = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/provider/check')) return Promise.resolve(response({ error: 'upstream returned a long provider failure' }, 400))
      return original!(input, init)
    })
    renderPage()
    await screen.findByText('openai-main')

    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Test Provider')).toBeInTheDocument()
    expect(screen.getByText('openai-main', { selector: '.arco-typography' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Test provider' }))
    expect(await screen.findByText('Test model is required for non-mock providers.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Test model'), { target: { value: 'gpt-test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test provider' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/check'))).toBe(true))
    const testIndex = fetchMock.mock.calls.findIndex((_, index) => requestPath(index).includes('/provider/check'))
    expect(requestBody(testIndex)).toEqual({ name: 'openai-main', model: 'gpt-test' })
    expect(await screen.findByText('Test failed')).toBeInTheDocument()
    expect(screen.getByText('upstream returned a long provider failure')).toBeInTheDocument()
    expect(screen.getByText('Test Provider')).toBeInTheDocument()
  })

  it('allows an empty model when testing a saved mock provider', async () => {
    const mockProvider = { ...provider, name: 'mock-main', protocol: 'mock' as const, endpoint: '', auth_token: '' }
    mockInitial({ items: [], hours: 6, bucket_minutes: 10, bucket_count: 36 }, mockProvider)
    renderPage()
    await screen.findByText('mock-main')
    fireEvent.click(screen.getByRole('button', { name: 'Test' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Test provider' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/check'))).toBe(true))
    const testIndex = fetchMock.mock.calls.findIndex((_, index) => requestPath(index).includes('/provider/check'))
    expect(requestBody(testIndex)).toEqual({ name: 'mock-main', model: '' })
  })

  it('confirms disable without producing the React 19 element.ref warning', async () => {
    mockInitial()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Disable' }))
    const dialog = await screen.findByRole('dialog', { name: 'Disable openai-main?' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/enabled'))).toBe(true))
    const enabledIndex = fetchMock.mock.calls.findIndex((_, index) => requestPath(index).includes('/provider/enabled'))
    expect(requestBody(enabledIndex)).toEqual({ name: 'openai-main', enabled: false })
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(consoleError.mock.calls.some((call) => call.some((value) => String(value).includes(react19RefWarning)))).toBe(false)
  })

  it('cancels and confirms delete without producing the React 19 element.ref warning', async () => {
    mockInitial()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement

    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    let dialog = await screen.findByRole('dialog', { name: 'Permanently delete openai-main?' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Permanently delete openai-main?' })).not.toBeInTheDocument()
    expect(countRequests('/provider/delete')).toBe(0)

    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    dialog = await screen.findByRole('dialog', { name: 'Permanently delete openai-main?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(countRequests('/provider/delete')).toBe(1))
    const deleteIndex = fetchMock.mock.calls.findIndex((_, index) => requestPath(index).includes('/provider/delete'))
    expect(requestBody(deleteIndex)).toEqual({ name: 'openai-main' })
    expect(consoleError.mock.calls.some((call) => call.some((value) => String(value).includes(react19RefWarning)))).toBe(false)
  })

  it('strips merged row metrics from edit and draft test payloads', async () => {
    mockInitial()
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Test model'), { target: { value: 'gpt-main' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test draft' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/check'))).toBe(true))
    const testIndex = fetchMock.mock.calls.findIndex((_, index) => requestPath(index).includes('/provider/check'))
    expect(requestBody(testIndex).provider.metrics).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/upsert'))).toBe(true))
    const saveIndex = fetchMock.mock.calls.findIndex((_, index) => requestPath(index).includes('/provider/upsert'))
    expect(requestBody(saveIndex).metrics).toBeUndefined()
  })

  it('edits canonical models and rejects alias identity conflicts', async () => {
    mockInitial()
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText(/Leave the list empty for unrestricted model access/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }))
    fireEvent.change(screen.getByLabelText('Model 2 canonical name'), { target: { value: 'new-model' } })
    fireEvent.change(screen.getByLabelText('Model 2 aliases'), { target: { value: 'gpt-alias' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/conflicts with gpt-main/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/upsert'))).toBe(false)
  })

  it('shows duration presets, human preview, and no-day guidance', async () => {
    mockInitial()
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    expect(await screen.findAllByRole('button', { name: '168h' })).not.toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Cooldown'), { target: { value: '1h30m' } })
    expect(screen.getByText(/1 hour 30 minutes/)).toBeInTheDocument()
    expect(screen.getAllByText(/d is not supported/).length).toBeGreaterThan(0)
  })

  it('applies provider mutations directly without showing external Apply', async () => {
    mockInitial()
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Disable' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Disable' }).at(-1) as HTMLElement)
    await waitFor(() => expect(fetchMock.mock.calls.some((_, index) => requestPath(index).includes('/provider/enabled'))).toBe(true))
    expect(screen.queryByRole('button', { name: /pending/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply external changes' })).not.toBeInTheDocument()
    expect(countRequests('/admin/config/apply')).toBe(0)
  })

  it('refreshes providers, routes, and metrics only after 30 idle seconds', async () => {
    vi.useFakeTimers()
    mockInitial()
    renderPage()
    await advance(0)
    expect(screen.getByText('openai-main')).toBeInTheDocument()
    expect(countRequests('/admin/config/providers')).toBe(2)
    expect(countRequests('/admin/config/routes')).toBe(1)

    await advance(29_000)
    expect(countRequests('/admin/config/providers')).toBe(2)
    expect(countRequests('/admin/config/routes')).toBe(1)

    await advance(1_000)
    expect(countRequests('/admin/config/providers')).toBe(4)
    expect(countRequests('/admin/config/routes')).toBe(2)
  })

  it.each([
    ['pointerdown', (page: HTMLElement) => fireEvent.pointerDown(page)],
    ['keydown', (page: HTMLElement) => fireEvent.keyDown(page, { key: 'Shift' })],
    ['input', (_page: HTMLElement) => fireEvent.input(screen.getByLabelText('Search providers'), { target: { value: 'openai' } })],
    ['change', (_page: HTMLElement) => fireEvent.change(screen.getByLabelText('Search providers'), { target: { value: 'openai' } })],
    ['scroll', (page: HTMLElement) => fireEvent.scroll(page)],
  ])('restarts a complete idle period after %s activity', async (_name, event) => {
    vi.useFakeTimers()
    mockInitial()
    const { container } = renderPage()
    await advance(0)
    const page = container.querySelector('.providers-page') as HTMLElement
    const initialCalls = fetchMock.mock.calls.length

    await advance(20_000)
    event(page)
    await advance(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(initialCalls)
    await advance(19_999)
    expect(fetchMock).toHaveBeenCalledTimes(initialCalls)
    await advance(1)
    expect(fetchMock.mock.calls.length).toBe(initialCalls + 3)
  })

  it('blocks idle refresh for edit, dirty draft, and test modals and recounts after each closes', async () => {
    vi.useFakeTimers()
    mockInitial()
    renderPage()
    await advance(0)
    const row = screen.getByText('openai-main').closest('tr') as HTMLElement
    const initialCalls = fetchMock.mock.calls.length

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'dirty-tag' } })
    await advance(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(initialCalls)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await advance(29_999)
    expect(fetchMock).toHaveBeenCalledTimes(initialCalls)
    await advance(1)
    expect(fetchMock.mock.calls.length).toBe(initialCalls + 3)
    await advance(0)

    fireEvent.click(within(screen.getByText('openai-main').closest('tr') as HTMLElement).getByRole('button', { name: 'Test' }))
    const afterEditRefresh = fetchMock.mock.calls.length
    await advance(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(afterEditRefresh)
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    await advance(30_000)
    expect(fetchMock.mock.calls.length).toBe(afterEditRefresh + 3)
  })

  it('blocks while confirmation and mutation are pending, then recounts without concurrent refresh', async () => {
    vi.useFakeTimers()
    let resolveMutation!: (value: Response) => void
    mockInitial()
    const original = fetchMock.getMockImplementation()
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/provider/enabled')) return new Promise<Response>((resolve) => { resolveMutation = resolve })
      return original!(input, init)
    })
    renderPage()
    await advance(0)
    const initialCalls = fetchMock.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    expect(screen.getByText('Disable openai-main?')).toBeInTheDocument()
    await advance(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(initialCalls)

    fireEvent.click(screen.getAllByRole('button', { name: 'Disable' }).at(-1) as HTMLElement)
    await advance(0)
    expect(countRequests('/provider/enabled')).toBe(1)
    await advance(60_000)
    expect(countRequests('/provider/enabled')).toBe(1)
    expect(countRequests('/admin/config/routes')).toBe(1)

    await act(async () => { resolveMutation(response({ ok: true, applied: true })); await Promise.resolve() })
    await advance(0)
    const afterMutation = fetchMock.mock.calls.length
    await advance(29_999)
    expect(fetchMock).toHaveBeenCalledTimes(afterMutation)
    await advance(1)
    expect(fetchMock.mock.calls.length).toBe(afterMutation + 3)
  })

  it('does not start a concurrent idle refresh while the previous refresh is fetching', async () => {
    vi.useFakeTimers()
    mockInitial()
    renderPage()
    await advance(0)
    const original = fetchMock.getMockImplementation()
    const resolvers: Array<() => void> = []
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
      resolvers.push(() => { void Promise.resolve(original!(input, init)).then(resolve) })
    }))

    await advance(30_000)
    expect(resolvers).toHaveLength(3)
    await advance(60_000)
    expect(resolvers).toHaveLength(3)
    await act(async () => { resolvers.splice(0).forEach((resolve) => resolve()); await Promise.resolve() })
    await advance(0)
    const afterFetch = fetchMock.mock.calls.length
    await advance(29_999)
    expect(fetchMock).toHaveBeenCalledTimes(afterFetch)
    await advance(1)
    expect(fetchMock.mock.calls.length).toBe(afterFetch + 3)
  })

  it('exposes focusable timeline bucket details in a popover without native title', async () => {
    mockInitial()
    renderPage()
    const bucket = await screen.findByRole('button', { name: /2026-07-23T00:00:00Z to 2026-07-23T00:10:00Z/ })
    expect(bucket).not.toHaveAttribute('title')
    bucket.focus()
    expect(bucket).toHaveFocus()
    fireEvent.mouseEnter(bucket)
    expect(await screen.findByText('2026-07-23 00:00:00 – 2026-07-23 00:10:00')).toBeInTheDocument()
    expect(screen.getByText('State: success')).toBeInTheDocument()
    expect(screen.getByText('Requests: 1')).toBeInTheDocument()
    expect(screen.getByText('Successes: 1')).toBeInTheDocument()
    expect(screen.getByText('Errors: 0')).toBeInTheDocument()
  })

  it('keeps health status compact and moves failure semantics into a popover', async () => {
    mockInitial()
    renderPage()
    const failures = await screen.findByText('Failures: 0')
    expect(screen.queryByText('Consecutive health failures: 0')).not.toBeInTheDocument()
    expect(screen.queryByText('Current failure streak; unlike Usage errors, this is not an all-time total.')).not.toBeInTheDocument()
    fireEvent.mouseEnter(failures)
    expect(await screen.findByText('Current consecutive recoverable failures. Unlike Usage errors, this resets after a successful request.')).toBeInTheDocument()
  })

  it('offers provider and route model candidates while preserving free input', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/metrics')) return Promise.resolve(response({ items: [metric], hours: 6, bucket_minutes: 10, bucket_count: 36 }))
      if (url.endsWith('/admin/config/providers')) return Promise.resolve(response({ items: [provider] }))
      if (url.endsWith('/admin/config/routes')) return Promise.resolve(response({ items: [{ name: 'route', target_model: 'route-target', model_map: { 'route-input': 'route-output' } }] }))
      return Promise.resolve(response({ ok: true }))
    })
    renderPage()
    const row = (await screen.findByText('openai-main')).closest('tr') as HTMLElement
    await waitFor(() => expect(countRequests('/admin/config/routes')).toBe(1))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const input = await screen.findByLabelText('Test model')
    const list = document.getElementById(input.getAttribute('list') || '') as HTMLDataListElement
    const candidates = Array.from(list.options, (option) => option.value)
    expect(candidates).toEqual(expect.arrayContaining(['route-input', 'route-output', 'route-target', 'gpt-main', 'gpt-alias']))
    fireEvent.change(input, { target: { value: 'custom-free-model' } })
    expect(input).toHaveValue('custom-free-model')
  })
})
