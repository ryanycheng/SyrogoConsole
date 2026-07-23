import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOKEN_STORAGE_KEY, setAdminToken } from './auth'
import { apiGet } from './client'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => {
  fetchMock.mockReset()
  window.localStorage.clear()
})

describe('api client', () => {
  it('sends the stored admin token', async () => {
    setAdminToken('admin-token')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(apiGet('/admin/overview')).resolves.toEqual({ ok: true })

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer admin-token')
  })

  it('clears the token on unauthorized responses', async () => {
    setAdminToken('bad-token')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid admin token' }), { status: 401, headers: { 'content-type': 'application/json' } }))

    await expect(apiGet('/admin/overview')).rejects.toThrow('invalid admin token')
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })
})
