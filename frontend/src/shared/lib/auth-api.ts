export const AUTH_TOKEN_STORAGE_KEY = 'gastronexo:auth:token'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

type MembershipRole = 'owner' | 'admin' | 'operator' | 'viewer'

export type AuthUser = {
  id: string
  email: string
  fullName: string
}

export type SessionOrganization = {
  id: string
  name: string
  slug: string
  role: MembershipRole
}

export type AuthSession = {
  token: string
  user: AuthUser
  organization: SessionOrganization
}

export type AuthMeResponse = {
  user: AuthUser
  organization: SessionOrganization
}

export type AuthLoginRequest = {
  email: string
  password: string
  organizationId?: string
}

export type AuthLoginResponse = AuthSession & {
  organizations: SessionOrganization[]
}

export class ApiError extends Error {
  public readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function getStoredToken() {
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
}

export function saveStoredToken(token: string) {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
}

export function clearStoredToken() {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
}

async function apiRequest<TResponse>(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  })

  let payload: unknown = null
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    payload = await response.json()
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredToken()
    }

    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : 'No se pudo completar la solicitud.'

    throw new ApiError(response.status, message)
  }

  return payload as TResponse
}

export async function login(input: AuthLoginRequest) {
  const response = await apiRequest<AuthLoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })

  saveStoredToken(response.token)
  return response
}

export async function getCurrentSession(token: string) {
  return apiRequest<AuthMeResponse>('/api/auth/me', { method: 'GET' }, token)
}
