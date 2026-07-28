import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteResource } from '../../api/types'
import { FeedbackProvider } from '../../app/feedback'
import { RoutesPage } from './RoutesPage'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const routes: RouteResource[] = [
  { name: 'primary', from_tags: ['shared', 'office'], to_tags: ['east'], strategy: 'failover', weights: {}, target_model: '', model_map: {}, match: { models: ['claude-*'] } },
  { name: 'fallback', from_tags: ['shared', 'mobile'], to_tags: ['west'], strategy: 'round_robin', weights: {}, target_model: 'claude-fixed', model_map: {}, match: null },
  { name: 'catch-all', from_tags: ['legacy'], to_tags: ['east', 'west'], strategy: 'weighted_round_robin', weights: { east: 2, west: 1 }, target_model: '', model_map: { '*': 'claude-sonnet' }, match: { models: ['*'] } },
  { name: 'context-states', from_tags: ['legacy'], to_tags: ['disabled', 'unmapped'], strategy: 'failover', weights: {}, target_model: '', model_map: {}, match: { models: ['legacy-model'] } },
]

const options = {
  inbounds: [
    { name: 'messages-api', protocol: 'anthropic_messages', path: '/v1/messages', clients: [{ ref: 'desktop-client', tag: 'office' }, { ref: 'shared-client', tag: 'shared' }] },
    { name: 'chat-api', protocol: 'openai_chat', path: '/v1/chat/completions', clients: [{ ref: 'mobile-client', tag: 'mobile' }, { ref: 'roaming-client', tag: 'shared' }] },
  ],
  outbounds: [
    { name: 'east-provider', protocol: 'anthropic_messages', tag: 'east' },
    { name: 'west-provider', protocol: 'openai_chat', tag: 'west' },
  ],
  client_tags: ['shared', 'office', 'mobile', 'legacy'],
  outbound_tags: ['east', 'west', 'disabled', 'unmapped'],
  routing_strategies: ['failover', 'round_robin', 'weighted_round_robin'],
}

const providers = {
  items: [
    { name: 'anthropic-east', protocol: 'anthropic_messages', tag: 'east', enabled: true, models: [{ name: 'claude-sonnet', aliases: ['sonnet'] }] },
    { name: 'openai-west', protocol: 'openai_chat', tag: 'west', enabled: true, models: [] },
    { name: 'compatible-west', protocol: 'openai_responses', tag: 'west', enabled: true, models: [] },
    { name: 'disabled-primary', protocol: 'anthropic_messages', tag: 'disabled', enabled: false, models: [] },
    { name: 'disabled-backup', protocol: 'openai_chat', tag: 'disabled', enabled: false, models: [] },
  ],
}

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockApi({ optionsStatus = 200, providersStatus = 200, mutationStatus = 200, routesBody = { items: routes, order_revision: 'revision-7' }, reorderStatus = 200 }: { optionsStatus?: number; providersStatus?: number; mutationStatus?: number; routesBody?: object; reorderStatus?: number } = {}) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/admin/config/routes')) return Promise.resolve(response(routesBody))
    if (url.endsWith('/admin/config/options')) return Promise.resolve(response(optionsStatus === 200 ? options : { error: 'options offline' }, optionsStatus))
    if (url.endsWith('/admin/config/providers')) return Promise.resolve(response(providersStatus === 200 ? providers : { error: 'providers offline' }, providersStatus))
    if (url.endsWith('/admin/config/routes/reorder')) return Promise.resolve(response(reorderStatus === 200 ? { ok: true, applied: true } : { error: 'Route order changed', error_code: 'route_order_conflict' }, reorderStatus))
    if (url.includes('/admin/config/route/')) return Promise.resolve(response(mutationStatus === 200 ? { ok: true, applied: true } : { error: 'Core rejected route' }, mutationStatus))
    return Promise.resolve(response({ ok: true, applied: true }))
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<MemoryRouter><FeedbackProvider><QueryClientProvider client={queryClient}><RoutesPage /></QueryClientProvider></FeedbackProvider></MemoryRouter>)
}

function requestBody(fragment: string) {
  const call = fetchMock.mock.calls.find(([input]) => String(input).includes(fragment))
  return JSON.parse(String(call?.[1]?.body || '{}'))
}

function countRequests(fragment: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(fragment)).length
}

async function openNewRoute() {
  const button = await screen.findByRole('button', { name: 'New' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  return screen.findByRole('dialog', { name: 'New route' })
}

async function chooseSingle(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label))
  const popupOption = await waitFor(() => {
    const match = screen.getAllByText(option).find((element) => element.closest('.arco-select-popup'))
    expect(match).toBeTruthy()
    return match as HTMLElement
  })
  fireEvent.click(popupOption)
}

async function chooseMultiple(label: string, optionsToChoose: string[]) {
  for (const option of optionsToChoose) {
    fireEvent.click(screen.getByLabelText(label))
    const popup = await waitFor(() => {
      const candidates = screen.getAllByText(option)
      const item = candidates.find((candidate) => candidate.closest('.arco-select-popup'))
      expect(item).toBeTruthy()
      return item as HTMLElement
    })
    fireEvent.click(popup)
  }
}

async function fillRequiredRoute(name: string) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
  await chooseMultiple('From tags', ['office'])
  await chooseMultiple('To tags', ['east'])
}

afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

describe('RoutesPage', () => {
  it('shows single resource context and shared resource details in the route list', async () => {
    mockApi()
    renderPage()

    const primary = (await screen.findByText('primary')).closest('tr') as HTMLElement
    expect(within(primary).getByText('desktop-client · messages-api')).toBeInTheDocument()
    expect(within(primary).getByText(/anthropic-east · anthropic_messages/)).toBeInTheDocument()
    expect(within(primary).getByText('enabled')).toHaveClass('route-provider-enabled')
    expect(within(primary).getByText('2 clients · 2 inbounds')).toBeInTheDocument()
    expect(within(primary).getByText('Shared')).toBeInTheDocument()

    const fallback = screen.getByText('fallback').closest('tr') as HTMLElement
    expect(within(fallback).getByText('2 providers')).toBeInTheDocument()
    expect(within(fallback).getAllByText('Shared')).toHaveLength(2)

    fireEvent.mouseEnter(within(primary).getByText('2 clients · 2 inbounds').closest('.route-tag-resource') as HTMLElement)
    const sourceTooltip = await screen.findByRole('tooltip')
    expect(sourceTooltip).toHaveTextContent('Client: shared-client')
    expect(sourceTooltip).toHaveTextContent('Inbound: messages-api')
    expect(sourceTooltip).toHaveTextContent('Protocol: anthropic_messages')
    expect(sourceTooltip).toHaveTextContent('Path: /v1/messages')
    expect(sourceTooltip).toHaveTextContent('Client: roaming-client')
    expect(sourceTooltip).toHaveTextContent('Inbound: chat-api')

    fireEvent.mouseLeave(within(primary).getByText('2 clients · 2 inbounds').closest('.route-tag-resource') as HTMLElement)
    fireEvent.mouseEnter(within(fallback).getByText('2 providers').closest('.route-tag-resource') as HTMLElement)
    await waitFor(() => {
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toHaveTextContent('Provider: openai-west')
      expect(tooltip).toHaveTextContent('Protocol: openai_chat')
      expect(tooltip).toHaveTextContent('Enabled: yes')
      expect(tooltip).toHaveTextContent('Provider: compatible-west')
      expect(tooltip).toHaveTextContent('Protocol: openai_responses')
    })
  })

  it('distinguishes unavailable disabled destinations from successfully loaded orphaned tags', async () => {
    mockApi()
    renderPage()

    const row = (await screen.findByText('context-states')).closest('tr') as HTMLElement
    expect(within(row).getByText('2 disabled providers')).toBeInTheDocument()
    expect(within(row).getByText('Unavailable')).toBeInTheDocument()
    expect(within(row).getAllByText('Orphaned')).toHaveLength(2)
    expect(within(row).getByText('No matching client')).toBeInTheDocument()
    expect(within(row).getByText('No matching provider')).toBeInTheDocument()
  })

  it('reports unavailable context rather than orphaned tags when context queries fail', async () => {
    mockApi({ optionsStatus: 503, providersStatus: 503 })
    renderPage()

    const row = (await screen.findByText('primary')).closest('tr') as HTMLElement
    expect(within(row).getAllByText('Context unavailable').length).toBeGreaterThan(0)
    expect(within(row).getAllByText('Client context not loaded').length).toBeGreaterThan(0)
    expect(within(row).getAllByText('Provider context not loaded').length).toBeGreaterThan(0)
    expect(screen.queryByText('Orphaned')).not.toBeInTheDocument()
  })

  it('preserves API order and original priority while explaining matcher-aware overlap and filtering', async () => {
    mockApi()
    renderPage()

    const primary = (await screen.findByText('primary')).closest('tr') as HTMLElement
    const fallback = screen.getByText('fallback').closest('tr') as HTMLElement
    const catchAll = screen.getByText('catch-all').closest('tr') as HTMLElement
    expect(primary).toHaveTextContent('#1')
    expect(fallback).toHaveTextContent('#2')
    expect(catchAll).toHaveTextContent('#3')
    expect(fallback).toHaveTextContent('Overlapping source tags: shared. First matching model wins.')
    expect(screen.getByText('context-states').closest('tr')).toHaveTextContent('Blocked by earlier fallback or * rules: legacy')
    expect(primary).not.toHaveTextContent('Blocked by earlier')

    fireEvent.change(screen.getByLabelText('Search routes'), { target: { value: 'catch-all' } })
    expect(screen.queryByText('primary')).not.toBeInTheDocument()
    expect(screen.queryByText('fallback')).not.toBeInTheDocument()
    expect(screen.getByText('catch-all').closest('tr')).toHaveTextContent('#3')
  })

  it('sends the strict seven-field failover and passthrough payload for a new route', async () => {
    mockApi()
    renderPage()
    await openNewRoute()
    await fillRequiredRoute('new-route')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(countRequests('/route/upsert')).toBe(1))
    expect(requestBody('/route/upsert')).toEqual({
      name: 'new-route',
      from_tags: ['office'],
      to_tags: ['east'],
      strategy: 'failover',
      weights: {},
      target_model: '',
      model_map: {},
      match: null,
    })
    expect(Object.keys(requestBody('/route/upsert'))).toHaveLength(8)
  })

  it('creates fallback and specific request model payloads and round-trips an edited matcher', async () => {
    mockApi()
    renderPage()
    await openNewRoute()
    await fillRequiredRoute('specific-route')
    fireEvent.click(screen.getByText('Specific models'))
    fireEvent.click(screen.getByRole('button', { name: 'Add pattern' }))
    fireEvent.change(screen.getByLabelText('Request model pattern 1'), { target: { value: 'claude-*' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add pattern' }))
    fireEvent.change(screen.getByLabelText('Request model pattern 2'), { target: { value: 'custom-model' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(countRequests('/route/upsert')).toBe(1))
    expect(requestBody('/route/upsert').match).toEqual({ models: ['claude-*', 'custom-model'] })

    cleanup()
    fetchMock.mockReset()
    mockApi()
    renderPage()
    const row = (await screen.findByText('primary')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit route: primary' })
    expect(within(dialog).getByLabelText('Request model pattern 1')).toHaveValue('claude-*')
    fireEvent.change(within(dialog).getByLabelText('Request model pattern 1'), { target: { value: 'claude-sonnet-*' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(countRequests('/route/upsert')).toBe(1))
    expect(requestBody('/route/upsert').match).toEqual({ models: ['claude-sonnet-*'] })
  })

  it('validates request model patterns without trimming or accepting duplicates and control characters', async () => {
    mockApi()
    renderPage()
    await openNewRoute()
    await fillRequiredRoute('invalid-match')
    fireEvent.click(screen.getByText('Specific models'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Add at least one model pattern.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add pattern' }))
    fireEvent.change(screen.getByLabelText('Request model pattern 1'), { target: { value: ' claude-*' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Model patterns cannot have leading or trailing whitespace.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Request model pattern 1'), { target: { value: 'claude-*' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add pattern' }))
    fireEvent.change(screen.getByLabelText('Request model pattern 2'), { target: { value: 'claude-*' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Model patterns must be unique.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Request model pattern 2'), { target: { value: 'badmodel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Model patterns cannot contain control characters.')).toBeInTheDocument()
    expect(countRequests('/route/upsert')).toBe(0)
  })

  it('displays request models and includes them in search', async () => {
    mockApi()
    renderPage()
    const primary = (await screen.findByText('primary')).closest('tr') as HTMLElement
    const fallback = screen.getByText('fallback').closest('tr') as HTMLElement
    expect(within(primary).getByText('Specific')).toBeInTheDocument()
    expect(within(primary).getByText('claude-*')).toBeInTheDocument()
    expect(within(fallback).getByText('Fallback')).toBeInTheDocument()
    expect(within(fallback).getByText('Any otherwise unmatched model')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search routes'), { target: { value: 'legacy-model' } })
    expect(screen.getByText('context-states')).toBeInTheDocument()
    expect(screen.queryByText('primary')).not.toBeInTheDocument()
  })

  it('reorders with global zero-based indexes and the current revision', async () => {
    mockApi()
    renderPage()
    const button = await screen.findByRole('button', { name: 'Move fallback down' })
    fireEvent.click(button)
    await waitFor(() => expect(countRequests('/routes/reorder')).toBe(1))
    expect(requestBody('/routes/reorder')).toEqual({ from_index: 1, to_index: 2, expected_revision: 'revision-7' })
    await waitFor(() => expect(countRequests('/admin/config/routes')).toBeGreaterThan(1))
  })

  it('disables reorder while filters are active', async () => {
    mockApi()
    renderPage()
    const down = await screen.findByRole('button', { name: 'Move fallback down' })
    expect(down).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Search routes'), { target: { value: 'fallback' } })
    expect(screen.getByRole('button', { name: 'Move fallback down' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Search routes'), { target: { value: '' } })
    await chooseSingle('Strategy filter', 'round_robin')
    expect(screen.getByRole('button', { name: 'Move fallback down' })).toBeDisabled()
  })

  it('refreshes and warns on a reorder revision conflict without optimistic movement', async () => {
    mockApi({ reorderStatus: 409 })
    renderPage()
    const fallback = (await screen.findByText('fallback')).closest('tr') as HTMLElement
    fireEvent.click(within(fallback).getByRole('button', { name: 'Move fallback up' }))
    await waitFor(() => expect(countRequests('/routes/reorder')).toBe(1))
    expect(screen.getByText('fallback').closest('tr')).toHaveTextContent('#2')
    expect(await screen.findByText(/Route order changed in Core/)).toBeInTheDocument()
    await waitFor(() => expect(countRequests('/admin/config/routes')).toBeGreaterThan(1))
  })

  it('normalizes missing match and disables sorting against an old Core without revision', async () => {
    const legacyRoutes = routes.map(({ match: _match, ...route }) => route)
    mockApi({ routesBody: { items: legacyRoutes } })
    renderPage()
    expect(await screen.findByText('Route ordering unavailable')).toBeInTheDocument()
    expect(screen.getByText(/Upgrade Core to enable route ordering/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move fallback up' })).toBeDisabled()
    const primary = screen.getByText('primary').closest('tr') as HTMLElement
    expect(within(primary).getByText('Fallback')).toBeInTheDocument()
    fireEvent.click(within(primary).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit route: primary' })
    expect(within(dialog).getByText('Fallback')).toBeInTheDocument()
  })

  it('creates weight inputs from selected destinations and sends exact weighted-round-robin weights', async () => {
    mockApi()
    renderPage()
    await openNewRoute()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'weighted' } })
    await chooseMultiple('From tags', ['mobile'])
    await chooseSingle('Strategy', 'weighted_round_robin')
    await chooseMultiple('To tags', ['east', 'west'])

    expect(screen.getByLabelText('Weight for east')).toHaveValue(1)
    expect(screen.getByLabelText('Weight for west')).toHaveValue(1)
    fireEvent.change(screen.getByLabelText('Weight for east'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Weight for west'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(countRequests('/route/upsert')).toBe(1))
    expect(requestBody('/route/upsert')).toEqual({
      name: 'weighted', from_tags: ['mobile'], to_tags: ['east', 'west'],
      strategy: 'weighted_round_robin', weights: { east: 7, west: 3 }, target_model: '', model_map: {}, match: null,
    })
  })

  it('sends mutually exclusive fixed-model and wildcard model-map payloads', async () => {
    mockApi()
    renderPage()
    await openNewRoute()
    await fillRequiredRoute('fixed-route')
    fireEvent.click(screen.getByText('Fixed'))
    fireEvent.change(screen.getByLabelText('Target model'), { target: { value: 'custom-fixed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(countRequests('/route/upsert')).toBe(1))
    expect(requestBody('/route/upsert')).toMatchObject({ target_model: 'custom-fixed', model_map: {} })

    cleanup()
    fetchMock.mockReset()
    mockApi()
    renderPage()
    await openNewRoute()
    await fillRequiredRoute('mapped-route')
    fireEvent.click(screen.getByText('Map'))
    fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }))
    fireEvent.change(screen.getByLabelText('Mapping 1 source'), { target: { value: '*' } })
    fireEvent.change(screen.getByLabelText('Mapping 1 target'), { target: { value: 'claude-sonnet' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(countRequests('/route/upsert')).toBe(1))
    expect(requestBody('/route/upsert')).toMatchObject({ target_model: '', model_map: { '*': 'claude-sonnet' } })
  })

  it('shows contextual From and To options inside the dialog while submitting plain tags', async () => {
    mockApi()
    renderPage()
    const dialog = await openNewRoute()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'context-route' } })

    fireEvent.click(within(dialog).getByLabelText('From tags'))
    const fromOption = await waitFor(() => {
      const match = screen.getAllByText('office').find((element) => element.closest('.arco-select-popup'))
      expect(match).toBeTruthy()
      return match as HTMLElement
    })
    const fromPopup = fromOption.closest('.arco-select-popup') as HTMLElement
    expect(dialog).toContainElement(fromPopup)
    expect(within(fromPopup).getByText('desktop-client · messages-api · anthropic_messages · /v1/messages')).toBeInTheDocument()
    expect(within(fromPopup).getByText('shared-client · messages-api · anthropic_messages · /v1/messages')).toBeInTheDocument()
    expect(within(fromPopup).getByText('roaming-client · chat-api · openai_chat · /v1/chat/completions')).toBeInTheDocument()
    fireEvent.click(fromOption)

    fireEvent.click(within(dialog).getByLabelText('To tags'))
    const toOption = await waitFor(() => {
      const match = screen.getAllByText('east').find((element) => element.closest('.arco-select-popup'))
      expect(match).toBeTruthy()
      return match as HTMLElement
    })
    const toPopup = toOption.closest('.arco-select-popup') as HTMLElement
    expect(dialog).toContainElement(toPopup)
    const eastProvider = within(toPopup).getByText(/anthropic-east · anthropic_messages/)
    expect(eastProvider).toBeInTheDocument()
    expect(within(eastProvider).getByText('enabled')).toHaveClass('route-provider-enabled')
    fireEvent.click(toOption)

    expect(within(dialog).getByLabelText('From tags').closest('.arco-select')).toHaveTextContent('office')
    expect(within(dialog).getByLabelText('From tags').closest('.arco-select')).not.toHaveTextContent('desktop-client')
    expect(within(dialog).getByLabelText('To tags').closest('.arco-select')).toHaveTextContent('east')
    expect(within(dialog).getByLabelText('To tags').closest('.arco-select')).not.toHaveTextContent('anthropic-east')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(countRequests('/route/upsert')).toBe(1))
    expect(requestBody('/route/upsert')).toMatchObject({ from_tags: ['office'], to_tags: ['east'] })
  })

  it('mounts Strategy, From tags, and To tags popups inside the route dialog', async () => {
    mockApi()
    renderPage()
    const dialog = await openNewRoute()

    for (const [label, option] of [['Strategy', 'round_robin'], ['From tags', 'office'], ['To tags', 'east']] as const) {
      fireEvent.click(screen.getByLabelText(label))
      const optionElement = await waitFor(() => {
        const match = screen.getAllByText(option).find((element) => element.closest('.arco-select-popup'))
        expect(match).toBeTruthy()
        return match as HTMLElement
      })
      expect(dialog).toContainElement(optionElement.closest('.arco-select-popup') as HTMLElement)
      fireEvent.click(optionElement)
    }
  })

  it('disables New and Edit when options fail but keeps deletion available', async () => {
    mockApi({ optionsStatus: 503 })
    renderPage()

    expect(await screen.findByText('Configuration options unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeDisabled()
    const row = screen.getByText('primary').closest('tr') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeEnabled()
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('dialog', { name: 'Permanently delete primary?' })).toBeInTheDocument()
  })

  it('keeps New available when provider model suggestions fail', async () => {
    mockApi({ providersStatus: 503 })
    renderPage()

    expect(await screen.findByText('Provider model suggestions unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    expect(await screen.findByRole('dialog', { name: 'New route' })).toBeInTheDocument()
  })

  it('disables deletion of the last route and requires the exact route name when multiple routes exist', async () => {
    mockApi()
    renderPage()
    const primaryRow = (await screen.findByText('primary')).closest('tr') as HTMLElement
    fireEvent.click(within(primaryRow).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Permanently delete primary?' })
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete' })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Confirm route name'), { target: { value: 'primar' } })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Confirm route name'), { target: { value: 'primary' } })
    expect(deleteButton).toBeEnabled()
    fireEvent.click(deleteButton)
    await waitFor(() => expect(countRequests('/route/delete')).toBe(1))
    expect(requestBody('/route/delete')).toEqual({ name: 'primary' })

    cleanup()
    fetchMock.mockReset()
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/admin/config/routes')) return Promise.resolve(response({ items: [routes[0]] }))
      if (url.endsWith('/admin/config/options')) return Promise.resolve(response(options))
      if (url.endsWith('/admin/config/providers')) return Promise.resolve(response(providers))
      return Promise.resolve(response({ ok: true, applied: true }))
    })
    renderPage()
    const onlyRow = (await screen.findByText('primary')).closest('tr') as HTMLElement
    expect(within(onlyRow).getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('keeps the editor open and displays the API error when a mutation fails', async () => {
    mockApi({ mutationStatus: 409 })
    renderPage()
    const dialog = await openNewRoute()
    await fillRequiredRoute('rejected-route')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByText('Unable to save route')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Core rejected route')
    expect(screen.getByRole('dialog', { name: 'New route' })).toBeInTheDocument()
  })

  it('confirms dirty cancellation, supports keeping changes, then discarding them', async () => {
    mockApi()
    renderPage()
    await openNewRoute()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'draft-route' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    let confirm = await screen.findByRole('dialog', { name: 'Discard unsaved route changes?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('dialog', { name: 'New route' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('draft-route')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    confirm = await screen.findByRole('dialog', { name: 'Discard unsaved route changes?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog', { name: 'New route' })).not.toBeInTheDocument()
  })
})
