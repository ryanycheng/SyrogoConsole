import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionItem } from '../../api/types'
import { SessionsPage } from './SessionsPage'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const now = new Date('2026-07-27T12:00:00Z')

function response(items: SessionItem[]) {
  return new Response(JSON.stringify({ items }), { headers: { 'content-type': 'application/json' } })
}

function renderPage(items: SessionItem[]) {
  fetchMock.mockResolvedValue(response(items))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <SessionsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function session(overrides: Partial<SessionItem> & Pick<SessionItem, 'id'>): SessionItem {
  return {
    client_name: overrides.id,
    inbound_name: 'claude-entry',
    cwd: `/workspace/${overrides.id}`,
    host: 'production-host',
    status: 'idle',
    started_at: '2026-07-27T10:00:00Z',
    last_seen_at: '2026-07-27T11:55:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(now)
  window.localStorage.clear()
  window.localStorage.setItem('syrogo_console_sessions_refresh_interval', '0')
})

afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  vi.useRealTimers()
})

describe('SessionsPage', () => {
  it('distinguishes a recent idle Stop from ended sessions', async () => {
    renderPage([
      session({ id: 'permission', status: 'waiting_permission', last_event: 'Notification' }),
      session({ id: 'recent-stop', status: 'idle', last_event: 'Stop', last_seen_at: '2026-07-27T11:35:00Z' }),
      session({ id: 'old-stop', status: 'idle', last_event: 'Stop', last_seen_at: '2026-07-27T11:29:59Z' }),
      session({ id: 'ended', status: 'stopped', last_event: 'SessionEnd', stopped_at: '2026-07-27T11:50:00Z' }),
    ])

    const current = await screen.findByRole('region', { name: 'Current sessions' })
    const ended = screen.getByRole('region', { name: 'Ended sessions' })

    expect(within(current).getByText('recent-stop')).toBeInTheDocument()
    expect(within(current).getByText('Recently stopped')).toBeInTheDocument()
    expect(within(current).getAllByText('idle')).toHaveLength(2)
    expect(within(current).getByText('old-stop')).toBeInTheDocument()
    expect(within(ended).getByText('ended')).toBeInTheDocument()
    expect(within(ended).getByText('SessionEnd')).toBeInTheDocument()
    expect(within(ended).queryByText('Recently stopped')).not.toBeInTheDocument()
    expect(screen.getByText('1 recently stopped')).toBeInTheDocument()
  })

  it('uses status rather than SessionEnd event to choose the ended section', async () => {
    renderPage([
      session({ id: 'inconsistent-running', status: 'running', last_event: 'SessionEnd' }),
      session({ id: 'stopped-after-stop', status: 'stopped', last_event: 'Stop', stopped_at: '2026-07-27T11:59:00Z' }),
    ])

    const current = await screen.findByRole('region', { name: 'Current sessions' })
    const ended = screen.getByRole('region', { name: 'Ended sessions' })

    expect(within(current).getByText('inconsistent-running')).toBeInTheDocument()
    expect(within(ended).getByText('stopped-after-stop')).toBeInTheDocument()
  })

  it('handles the 30 minute boundary and invalid timestamps', async () => {
    renderPage([
      session({ id: 'at-boundary', last_event: 'Stop', last_seen_at: '2026-07-27T11:30:00Z' }),
      session({ id: 'future-clock', last_event: 'Stop', last_seen_at: '2026-07-27T12:01:00Z' }),
      session({ id: 'invalid-time', last_event: 'Stop', last_seen_at: 'invalid' }),
      session({ id: 'missing-time', last_event: 'Stop', last_seen_at: undefined }),
    ])

    const current = await screen.findByRole('region', { name: 'Current sessions' })
    expect(within(current).getAllByText('Recently stopped')).toHaveLength(2)
    expect(within(current).getByText('invalid-time')).toBeInTheDocument()
    expect(within(current).getByText('missing-time')).toBeInTheDocument()
  })

  it('moves a recent Stop back to normal idle without fetching again', async () => {
    renderPage([session({ id: 'aging-stop', last_event: 'Stop', last_seen_at: '2026-07-27T11:30:30Z' })])

    expect(await screen.findByText('Recently stopped')).toBeInTheDocument()
    const requests = fetchMock.mock.calls.length

    await vi.advanceTimersByTimeAsync(60_000)

    await waitFor(() => expect(screen.queryByText('Recently stopped')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(requests)
  })

  it('preserves attention-first and recent-activity order in lifecycle sections', async () => {
    renderPage([
      session({ id: 'permission-old', status: 'waiting_permission', last_event: 'Notification', last_seen_at: '2026-07-27T11:30:00Z' }),
      session({ id: 'idle-notification-new', status: 'idle', last_event: 'Notification', last_seen_at: '2026-07-27T11:59:00Z' }),
      session({ id: 'recent-stop', status: 'idle', last_event: 'Stop', last_seen_at: '2026-07-27T11:50:00Z' }),
      session({ id: 'running-old', status: 'running', last_event: 'UserPromptSubmit', last_seen_at: '2026-07-27T11:40:00Z' }),
      session({ id: 'ended-new', status: 'stopped', last_event: 'SessionEnd', last_seen_at: '2026-07-27T11:58:00Z' }),
    ])

    const current = await screen.findByRole('region', { name: 'Current sessions' })
    const currentCards = current.querySelectorAll('.session-card')
    expect([...currentCards].map((card) => card.textContent)).toEqual([
      expect.stringContaining('permission-old'),
      expect.stringContaining('idle-notification-new'),
      expect.stringContaining('recent-stop'),
      expect.stringContaining('running-old'),
    ])
    expect(within(current).getByText('Recently stopped')).toBeInTheDocument()
    expect(within(current).getAllByText('Notification')).toHaveLength(2)

    fireEvent.click(screen.getByText('Table'))
    const currentRows = within(current).getAllByRole('row').slice(1)
    expect(currentRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('permission-old'),
      expect.stringContaining('idle-notification-new'),
      expect.stringContaining('recent-stop'),
      expect.stringContaining('running-old'),
    ])
    expect(within(screen.getByRole('region', { name: 'Ended sessions' })).getByText('ended-new')).toBeInTheDocument()
  })

  it('keeps lifecycle sections in table view', async () => {
    renderPage([
      session({ id: 'current-table', status: 'running', last_event: 'UserPromptSubmit' }),
      session({ id: 'ended-table', status: 'stopped', last_event: 'SessionEnd' }),
    ])

    await screen.findByText('current-table')
    fireEvent.click(screen.getByText('Table'))

    const current = screen.getByRole('region', { name: 'Current sessions' })
    const ended = screen.getByRole('region', { name: 'Ended sessions' })
    expect(within(current).getByText('current-table')).toBeInTheDocument()
    expect(within(current).queryByText('ended-table')).not.toBeInTheDocument()
    expect(within(ended).getByText('ended-table')).toBeInTheDocument()
  })

  it('keeps favorite sessions in their lifecycle section and exposes full values', async () => {
    window.localStorage.setItem('syrogo_console_favorite_sessions', JSON.stringify(['favorite-stop']))
    renderPage([
      session({
        id: 'favorite-stop',
        client_name: 'favorite-client-with-a-long-name',
        last_event: 'Stop',
        last_seen_at: '2026-07-27T11:55:00Z',
        cwd: '/workspace/a/very/long/production/path',
      }),
    ])

    expect(await screen.findByText('Favorite Sessions')).toBeInTheDocument()
    expect(screen.getAllByText('favorite-client-with-a-long-name')).toHaveLength(2)
    expect(screen.getAllByText('Recently stopped')).toHaveLength(2)
    expect(screen.getAllByTitle('Stop')).toHaveLength(2)
    expect(screen.getAllByTitle('/workspace/a/very/long/production/path')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Unfavorite session favorite-stop' })).toHaveLength(2)
  })
})
