export interface ApiErrorBody {
  error?: unknown
  error_code?: unknown
  details?: unknown
}

export class ApiError extends Error {
  status: number
  body: unknown
  errorCode?: string
  details?: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    if (body && typeof body === 'object') {
      const payload = body as ApiErrorBody
      if (typeof payload.error_code === 'string') this.errorCode = payload.error_code
      this.details = payload.details
    }
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Request failed'
}
