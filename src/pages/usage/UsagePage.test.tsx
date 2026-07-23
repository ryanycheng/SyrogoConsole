import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsagePage } from './UsagePage'

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>()
  return {
    ...actual,
    DatePicker: {
      ...actual.DatePicker,
      RangePicker: ({ onChange }: { onChange: (dateStrings: string[]) => void }) => (
        <div>
          <input placeholder="Start date (UTC)" onChange={(event) => onChange(event.target.value ? [event.target.value] : [])} />
          <input placeholder="End date (UTC)" onChange={(event) => {
            const start = (document.querySelector('[placeholder="Start date (UTC)"]') as HTMLInputElement).value
            onChange(start && event.target.value ? [start, event.target.value] : [])
          }} />
        </div>
      ),
    },
  }
})

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><UsagePage /></QueryClientProvider>)
}

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function selectOption(currentLabel: string, optionLabel: string) {
  const select = screen.getByText(currentLabel).closest('[role="combobox"]') as HTMLElement
  fireEvent.click(select)
  const listbox = await screen.findByRole('listbox')
  fireEvent.click(within(listbox).getByText(optionLabel))
}

function requestedURL(call = 0): URL {
  return new URL(String(fetchMock.mock.calls[call][0]), 'http://localhost')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-23T18:45:00Z'))
})

afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  vi.useRealTimers()
})

describe('UsagePage', () => {
  it('queries the last seven UTC calendar days by default without window or bucket', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [] }))

    renderPage()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const url = requestedURL()
    expect(url.searchParams.get('group_by')).toBe('date')
    expect(url.searchParams.get('start_date')).toBe('2026-07-17')
    expect(url.searchParams.get('end_date')).toBe('2026-07-24')
    expect([...url.searchParams.keys()].sort()).toEqual(['end_date', 'group_by', 'start_date'])
    expect(screen.getByText('Last 7 days')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/bucket/i)).not.toBeInTheDocument()
  })

  it.each([
    ['Last 30 days', '2026-06-24', '2026-07-24'],
    ['This month', '2026-07-01', '2026-07-24'],
  ])('applies the %s UTC preset', async (label, startDate, endDate) => {
    fetchMock.mockResolvedValue(response({ items: [] }))
    renderPage()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await selectOption('Last 7 days', label)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const url = requestedURL(1)
    expect(url.searchParams.get('start_date')).toBe(startDate)
    expect(url.searchParams.get('end_date')).toBe(endDate)
  })

  it('waits for a complete custom range and sends the inclusive UI end as an exclusive next day', async () => {
    fetchMock.mockResolvedValue(response({ items: [] }))
    renderPage()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await selectOption('Last 7 days', 'Custom range')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const startInput = screen.getByPlaceholderText('Start date (UTC)')
    const endInput = screen.getByPlaceholderText('End date (UTC)')
    fireEvent.change(startInput, { target: { value: '2026-07-03' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.change(endInput, { target: { value: '2026-07-09' } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const url = requestedURL(1)
    expect(url.searchParams.get('start_date')).toBe('2026-07-03')
    expect(url.searchParams.get('end_date')).toBe('2026-07-10')
  })

  it('uses record.value with a readable group label and only metric columns', async () => {
    fetchMock.mockResolvedValue(response({ items: [{ value: 'claude-sonnet', request_count: 3, total_tokens: 42 }] }))
    renderPage()
    await screen.findByText('claude-sonnet')

    await selectOption('Group by Date', 'Group by Model')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const table = screen.getByText('Usage Breakdown').closest('.arco-card') as HTMLElement
    expect(within(table).getByRole('columnheader', { name: 'Model' })).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Date' })).not.toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Agent' })).not.toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Session' })).not.toBeInTheDocument()
    expect(requestedURL(1).searchParams.get('group_by')).toBe('model')
  })

  it('refreshes without changing the selected range', async () => {
    fetchMock.mockResolvedValue(response({ items: [] }))
    renderPage()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await selectOption('Last 7 days', 'Last 30 days')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled())

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(requestedURL(2).searchParams.get('start_date')).toBe('2026-06-24')
    expect(requestedURL(2).searchParams.get('end_date')).toBe('2026-07-24')
  })

  it('displays API errors', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'usage unavailable' }, 500))
    renderPage()
    expect(await screen.findByText('usage unavailable')).toBeInTheDocument()
  })
})
