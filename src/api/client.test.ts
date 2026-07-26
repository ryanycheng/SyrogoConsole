import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOKEN_STORAGE_KEY, setAdminToken } from './auth'
import { apiGet, apiPost, apiPostText } from './client'
import { ApiError } from './errors'

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

  it('parses structured error codes and details', async () => {
    const details = { operation: 'delete', client: 'office-key', inbound: 'openai-entry', tag: 'office', route_names: ['default-route'] }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'binding is still required', error_code: 'binding_tag_last_source', details }), { status: 409, headers: { 'content-type': 'application/json' } }))

    const error = await apiGet('/admin/config/client-binding/delete').catch((value) => value)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, errorCode: 'binding_tag_last_source', details })
  })

  it('sends raw YAML with a revision precondition', async () => {
    setAdminToken('admin-token')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, saved: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const yaml = 'admin:\n  enabled: true\n'

    await apiPostText('/admin/config/update', yaml, 'sha256:abc123')

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Headers
    expect(init.body).toBe(yaml)
    expect(headers.get('Content-Type')).toBe('application/yaml')
    expect(headers.get('If-Match')).toBe('sha256:abc123')
    expect(headers.get('Authorization')).toBe('Bearer admin-token')
  })

  it('keeps JSON encoding for regular posts', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await apiPost('/admin/config/rollback', { id: 'history-id' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBe(JSON.stringify({ id: 'history-id' }))
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json')
  })

  it('preserves revision conflict response details', async () => {
    const body = { error: 'config file changed since it was loaded', code: 'config_revision_conflict', current_revision: 'sha256:new' }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 409, headers: { 'content-type': 'application/json' } }))

    const error = await apiPostText('/admin/config/update', 'server: {}', 'sha256:old').catch((value) => value)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, body })
  })

  it('clears the token on unauthorized responses', async () => {
    setAdminToken('bad-token')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid admin token' }), { status: 401, headers: { 'content-type': 'application/json' } }))

    await expect(apiGet('/admin/overview')).rejects.toThrow('invalid admin token')
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })
})
