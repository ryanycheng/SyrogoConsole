import { clearAdminToken, getAdminToken } from './auth'
import { ApiError } from './errors'

const configuredBaseURL = import.meta.env.VITE_SYROGO_API_BASE?.replace(/\/$/, '') || ''

export type QueryValue = string | number | boolean | null | undefined

export function apiBaseURL(): string {
  return configuredBaseURL
}

export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value))
    }
  })
  const query = search.toString()
  return query ? `?${query}` : ''
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function apiPostText<T>(path: string, body: string, ifMatch?: string): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/yaml' })
  if (ifMatch) headers.set('If-Match', ifMatch)
  return apiRequest<T>(path, { method: 'POST', body, headers })
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminToken()
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${configuredBaseURL}${path}`, {
    ...init,
    headers,
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    if (response.status === 401) clearAdminToken()
    const message = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : response.statusText
    throw new ApiError(response.status, message || 'Request failed', body)
  }

  return body as T
}
