export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Request failed'
}
