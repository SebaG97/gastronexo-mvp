import type { AuthSession } from './api'

const storageKey = 'gastronexo.dev.session'

export function loadSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as AuthSession
    if (!parsed?.token || !parsed?.user) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function saveSession(session: AuthSession): void {
  sessionStorage.setItem(storageKey, JSON.stringify(session))
}

export function clearSession(): void {
  sessionStorage.removeItem(storageKey)
}
