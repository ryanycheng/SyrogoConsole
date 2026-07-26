import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogsPage } from './LogsPage'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><LogsPage /></QueryClientProvider>)
}

function response(body: object) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function item(message: string) {
  return { time: '2026-07-20T11:58:00Z', level: 'INFO', message, content: `level=INFO msg=${message}`, parsed: true }
}

afterEach(() => {
  cleanup()
  fetchMock.mockReset()
})

describe('LogsPage', () => {
  it('queries the last five minutes with a 200 row limit by default', async () => {
    fetchMock.mockResolvedValueOnce(response({ path: '/tmp/dev.log', items: [item('recent')], line_count: 1, has_more: false }))

    renderPage()

    await screen.findByText('recent')
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.searchParams.get('limit')).toBe('200')
    const since = new Date(String(url.searchParams.get('since'))).getTime()
    const until = new Date(String(url.searchParams.get('until'))).getTime()
    expect(until - since).toBe(5 * 60 * 1000)
  })

  it('loads an earlier page with the same range and cursor', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ items: [item('newer')], line_count: 1, has_more: true, next_cursor: 'next-page' }))
      .mockResolvedValueOnce(response({ items: [item('older')], line_count: 1, has_more: false }))

    renderPage()
    await screen.findByText('newer')
    const firstURL = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier logs' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const secondURL = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost')
    expect(secondURL.searchParams.get('cursor')).toBe('next-page')
    expect(secondURL.searchParams.get('since')).toBe(firstURL.searchParams.get('since'))
    expect(secondURL.searchParams.get('until')).toBe(firstURL.searchParams.get('until'))
    expect(await screen.findByText('older')).toBeInTheDocument()
    expect(screen.getByText('newer')).toBeInTheDocument()
  })

  it('loads an earlier page automatically when the table scrolls near the bottom', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ items: [item('newer')], line_count: 1, has_more: true, next_cursor: 'auto-page' }))
      .mockResolvedValueOnce(response({ items: [item('older')], line_count: 1, has_more: false }))

    const { container } = renderPage()
    await screen.findByText('newer')
    const tableBody = container.querySelector('.arco-table-body') as HTMLDivElement
    Object.defineProperties(tableBody, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 520 },
      scrollTop: { configurable: true, value: 350 },
    })
    fireEvent.scroll(tableBody)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const secondURL = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost')
    expect(secondURL.searchParams.get('cursor')).toBe('auto-page')
    expect(await screen.findByText('older')).toBeInTheDocument()
  })

  it('sends text and field filters to the server', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ items: [], line_count: 0, has_more: false }))
      .mockResolvedValueOnce(response({ items: [item('request failed')], line_count: 1, has_more: false }))

    renderPage()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const input = screen.getByPlaceholderText(/Search text or use/)
    fireEvent.change(input, { target: { value: 'request failed level:ERROR status:5xx client:"Claude Code"' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const url = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost')
    expect(url.searchParams.get('q')).toBe('request,failed')
    expect(url.searchParams.get('level')).toBe('ERROR')
    expect(url.searchParams.get('status')).toBe('5xx')
    expect(url.searchParams.get('client')).toBe('Claude Code')
  })

  it.each([
    ['5xx', 'status:5xx'],
    ['4xx', 'status:4xx'],
  ])('applies the %s shortcut as a server status filter', async (label, statusFilter) => {
    fetchMock
      .mockResolvedValueOnce(response({ items: [], line_count: 0, has_more: false }))
      .mockResolvedValueOnce(response({ items: [], line_count: 0, has_more: false }))

    renderPage()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const url = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost')
    expect(url.searchParams.get('status')).toBe(statusFilter.slice('status:'.length))
    cleanup()
    fetchMock.mockReset()
  })

  it('shows memory source and archive file count in the three-item summary', async () => {
    fetchMock.mockResolvedValueOnce(response({
      path: '/tmp/dev.log', source: 'memory', items: [item('recent')], line_count: 1,
      scanned_line_count: 2, scanned_file_count: 3, includes_archives: true, has_more: false,
    }))

    renderPage()
    await screen.findByText('recent')
    expect(screen.getByText(/Memory · 1 matched · 2 scanned/)).toBeInTheDocument()
    expect(screen.getByText(/3 files including history/)).toBeInTheDocument()
    expect(document.querySelectorAll('.arco-descriptions-item-label')).toHaveLength(3)
  })

  it('refreshes with the current input after filters are removed', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ items: [], line_count: 0, has_more: false }))
      .mockResolvedValueOnce(response({ items: [], line_count: 0, has_more: false }))
      .mockResolvedValueOnce(response({ items: [item('unfiltered')], line_count: 1, has_more: false }))

    renderPage()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const input = screen.getByPlaceholderText(/Search text or use/)
    fireEvent.change(input, { target: { value: 'level:ERROR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const url = new URL(String(fetchMock.mock.calls[2][0]), 'http://localhost')
    expect(url.searchParams.has('level')).toBe(false)
  })
})
