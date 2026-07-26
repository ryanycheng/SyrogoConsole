import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeedbackProvider } from '../../app/feedback'
import { SystemConfigPage } from './SystemConfigPage'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const current = {
  config_ready: true,
  redacted_content: 'admin:\n  token: <redacted>\n',
  revision: 'sha256:abcdef1234567890',
  checksum: 'abcdef1234567890',
}
const history = { items: [{ id: 'history-1', created_at: '2026-07-26T12:00:00Z', reason: 'apply', checksum: '1234567890abcdef' }] }

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockApi() {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/admin/config')) return Promise.resolve(response(current))
    if (url.endsWith('/admin/config/history')) return Promise.resolve(response(history))
    if (url.includes('/admin/config/history/diff')) return Promise.resolve(response({ id: 'history-1', history_content: 'admin:\n  token: <redacted>\n', current_content: 'admin:\n  enabled: true\n  token: <redacted>\n' }))
    if (url.endsWith('/admin/config/validate')) return Promise.resolve(response({ ok: true }))
    if (url.endsWith('/admin/config/update')) return Promise.resolve(response({ ok: true, saved: true, applied: false, revision: 'sha256:new', checksum: 'new' }))
    if (url.endsWith('/admin/config/apply')) return Promise.resolve(response({ ok: true, saved: false, applied: false, restart_required: true, reason: 'listener address changed', quota_state_reset: false }))
    if (url.endsWith('/admin/config/rollback')) return Promise.resolve(response({ ok: true, saved: true, applied: true, restart_required: false, history_id: 'rollback-1', quota_state_reset: true }))
    return Promise.resolve(response({ ok: true }))
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<MemoryRouter><FeedbackProvider><QueryClientProvider client={queryClient}><SystemConfigPage /></QueryClientProvider></FeedbackProvider></MemoryRouter>)
}

function request(fragment: string) {
  return fetchMock.mock.calls.find(([input]) => String(input).includes(fragment))
}

afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  vi.restoreAllMocks()
})

describe('SystemConfigPage', () => {
  it('shows only redacted inspect content and starts with an empty replacement editor', async () => {
    mockApi()
    renderPage()

    const inspect = await screen.findByLabelText('Redacted current config')
    await waitFor(() => expect(inspect).toHaveValue(current.redacted_content))
    expect(inspect).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Complete replacement config')).toHaveValue('')
    expect(screen.getByText('Revision abcdef123456')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Providers' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Clients' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Routes' })).toBeEnabled()
  })

  it('validates raw YAML, requires confirmation, and updates with the loaded revision', async () => {
    mockApi()
    renderPage()
    const inspect = await screen.findByLabelText('Redacted current config')
    await waitFor(() => expect(inspect).toHaveValue(current.redacted_content))
    const draft = 'admin:\n  enabled: true\n  token: complete-secret\n'

    fireEvent.change(screen.getByLabelText('Complete replacement config'), { target: { value: draft } })
    expect(screen.getByRole('button', { name: 'Update file' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    await screen.findByText('Configuration is valid')

    const validateRequest = request('/admin/config/validate')
    expect(validateRequest).toBeDefined()
    const validateInit = validateRequest![1] as RequestInit
    expect(validateInit.body).toBe(draft)
    expect((validateInit.headers as Headers).get('Content-Type')).toBe('application/yaml')
    expect(screen.getByRole('button', { name: 'Update file' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Update file' }))
    const dialog = await screen.findByRole('dialog', { name: 'Replace the complete config file?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update file' }))

    await screen.findByText('File updated, not applied')
    const updateRequest = request('/admin/config/update')
    expect(updateRequest).toBeDefined()
    const updateInit = updateRequest![1] as RequestInit
    expect(updateInit.body).toBe(draft)
    expect((updateInit.headers as Headers).get('If-Match')).toBe(current.revision)
    expect(screen.getByLabelText('Complete replacement config')).toHaveValue('')
  })

  it('rejects redacted replacement content before validation', async () => {
    mockApi()
    renderPage()
    const inspect = await screen.findByLabelText('Redacted current config')
    await waitFor(() => expect(inspect).toHaveValue(current.redacted_content))

    fireEvent.change(screen.getByLabelText('Complete replacement config'), { target: { value: current.redacted_content } })
    expect(screen.getByText(/Replace <redacted> values/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Validate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Update file' })).toBeDisabled()
  })

  it('preserves a draft and reports a revision conflict', async () => {
    mockApi()
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/admin/config')) return Promise.resolve(response(current))
      if (url.endsWith('/admin/config/history')) return Promise.resolve(response(history))
      if (url.endsWith('/admin/config/validate')) return Promise.resolve(response({ ok: true }))
      if (url.endsWith('/admin/config/update')) return Promise.resolve(response({ error: 'config file changed', code: 'config_revision_conflict', current_revision: 'sha256:new' }, 409))
      return Promise.resolve(response({ ok: true }))
    })
    renderPage()
    const inspect = await screen.findByLabelText('Redacted current config')
    await waitFor(() => expect(inspect).toHaveValue(current.redacted_content))
    const draft = 'admin:\n  enabled: true\n'
    fireEvent.change(screen.getByLabelText('Complete replacement config'), { target: { value: draft } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    await screen.findByText('Configuration is valid')
    fireEvent.click(screen.getByRole('button', { name: 'Update file' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Update file' }))

    expect(await screen.findByText('Configuration changed on the server')).toBeInTheDocument()
    expect(screen.getByLabelText('Complete replacement config')).toHaveValue(draft)
  })

  it('applies the server file independently and keeps restart-required details visible', async () => {
    mockApi()
    renderPage()
    const inspect = await screen.findByLabelText('Redacted current config')
    await waitFor(() => expect(inspect).toHaveValue(current.redacted_content))
    fireEvent.change(screen.getByLabelText('Complete replacement config'), { target: { value: 'draft: true' } })

    fireEvent.click(screen.getByRole('button', { name: 'Apply current file' }))
    const dialog = await screen.findByRole('dialog', { name: 'Apply the current config file?' })
    expect(dialog).toHaveTextContent('unsubmitted replacement draft will not be applied')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('Restart required')).toBeInTheDocument()
    expect(screen.getAllByText('listener address changed')).not.toHaveLength(0)
    expect(screen.getByLabelText('Complete replacement config')).toHaveValue('draft: true')
  })

  it('compares redacted history and confirms rollback results', async () => {
    mockApi()
    renderPage()
    await screen.findByText('history-1')
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))

    expect(await screen.findByText('Historical config')).toBeInTheDocument()
    expect(screen.getByText('Current config')).toBeInTheDocument()
    expect(screen.getAllByText(/token: <redacted>/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Rollback' }))
    const dialog = await screen.findByRole('dialog', { name: 'Roll back to history-1?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rollback' }))
    expect(await screen.findByText('Applied with quota reset')).toBeInTheDocument()
  })

  it('reports an unsupported Core response instead of leaving comparison loading', async () => {
    mockApi()
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/admin/config')) return Promise.resolve(response(current))
      if (url.endsWith('/admin/config/history')) return Promise.resolve(response(history))
      if (url.includes('/admin/config/history/diff')) return Promise.resolve(response({ ok: true }))
      return Promise.resolve(response({ ok: true }))
    })
    renderPage()
    await screen.findByText('history-1')

    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))

    expect(await screen.findByText('Unable to compare history')).toBeInTheDocument()
    expect(screen.getByText(/Upgrade and restart Syrogo Core/)).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('shows a stable unavailable state when Core has no config path', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => String(input).endsWith('/admin/config') ? Promise.resolve(response({ config_ready: false, redacted_content: '', revision: '', checksum: '' })) : Promise.resolve(response({ items: [] })))
    renderPage()

    expect(await screen.findByText('Configuration file unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply current file' })).toBeDisabled()
  })
})
