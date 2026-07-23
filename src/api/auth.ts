export const TOKEN_STORAGE_KEY = 'syrogo_console_admin_token'

export function getAdminToken(): string {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY) || ''
}

export function setAdminToken(token: string): void {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function clearAdminToken(): void {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY)
}

export function hasAdminToken(): boolean {
  return getAdminToken().trim().length > 0
}
