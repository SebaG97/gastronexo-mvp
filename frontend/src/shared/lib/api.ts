export type UserSession = {
  id: number
  email: string
  name: string
}

export type AuthSession = {
  token: string
  user: UserSession
}

export type ProductItem = {
  id: number
  name: string
  sku: string | null
  unit: string
  stock: number
  createdAt: string
  updatedAt: string
}

type ApiErrorBody = {
  message?: string
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function getBaseUrl() {
  return (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '')
}

function buildUrl(path: string) {
  return `${getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody
    return body.message ?? response.statusText ?? 'Unexpected error'
  } catch {
    return response.statusText || 'Unexpected error'
  }
}

async function requestJson<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(buildUrl(path), {
    ...init,
    headers,
  })

  if (!response.ok) {
    throw new ApiError(await parseError(response), response.status)
  }

  return (await response.json()) as T
}

export async function loginRequest(email: string, password: string): Promise<AuthSession> {
  return requestJson<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function registerRequest(name: string, email: string, password: string): Promise<AuthSession> {
  return requestJson<AuthSession>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  })
}

export async function getCurrentUser(token: string): Promise<UserSession> {
  const payload = await requestJson<{ user: UserSession }>('/api/auth/me', undefined, token)
  return payload.user
}

export async function getProducts(token: string): Promise<ProductItem[]> {
  const payload = await requestJson<{ items: ProductItem[] }>('/api/products', undefined, token)
  return payload.items
}

export async function createProduct(
  token: string,
  product: { name: string; sku?: string; unit?: string; stock?: number },
): Promise<ProductItem> {
  const payload = await requestJson<{ item: ProductItem }>('/api/products', {
    method: 'POST',
    body: JSON.stringify(product),
  }, token)
  return payload.item
}
