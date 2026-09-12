export const AUTH_TOKEN_STORAGE_KEY = 'gastronexo:auth:token'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

type MembershipRole = 'owner' | 'admin' | 'operator' | 'viewer'

export type OrganizationCapabilities = {
  canReadProducts: boolean
  canWriteProducts: boolean
  canWriteAdmin: boolean
}

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
  capabilities: OrganizationCapabilities
}

export type AuthSession = {
  token: string
  user: AuthUser
  organization: SessionOrganization
}

export type OrganizationMembershipListResponse = {
  organizations: SessionOrganization[]
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

export type AuthSwitchOrganizationRequest = {
  organizationId: string
}

export type AuthSwitchOrganizationResponse = {
  token: string
  organization: SessionOrganization
}

type MemberRole = MembershipRole

export type OrganizationMember = {
  userId: string
  fullName: string
  email: string
  role: MemberRole
  actions: {
    canChangeRole: boolean
    assignableRoles: Array<'admin' | 'operator' | 'viewer'>
    canRevoke: boolean
  }
}

export type OrganizationMembersResponse = {
  members: OrganizationMember[]
}

export type Product = {
  id: string
  name: string
  sku: string | null
  unit: ProductUnit
  productType: ProductType
  cost: number
  categoryId: string | null
  categoryName: string | null
  isActive: boolean
  createdAt: string
}

export type ProductUnit = 'unit' | 'kg' | 'g' | 'l' | 'ml' | 'box' | 'portion'
export type ProductType = 'raw_material' | 'finished_product'

export type ProductCategory = {
  id: string
  name: string
  isActive: boolean
  createdAt: string
}

export type ProductCategoriesStatusFilter = 'active' | 'inactive' | 'all'

export type ProductCategoriesListResponse = {
  categories: ProductCategory[]
}

export type ProductsStatusFilter = 'active' | 'inactive' | 'all'

export type ProductsListRequest = {
  q?: string
  status?: ProductsStatusFilter
  productType?: ProductType
  page?: number
  pageSize?: number
}

export type ProductsListResponse = {
  products: Product[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export type ProductMutationInput = {
  name: string
  sku?: string
  unit: ProductUnit
  productType: ProductType
  cost: number
  categoryId?: string | null
}

export type WarehousesStatusFilter = 'active' | 'inactive' | 'all'

export type Warehouse = {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type WarehousesListResponse = {
  warehouses: Warehouse[]
}

export type InventoryBalance = {
  productId: string
  productName: string
  sku: string | null
  productType: ProductType
  unit: ProductUnit
  cost: number
  categoryId: string | null
  categoryName: string | null
  warehouseId: string
  warehouseName: string
  quantity: string
  updatedAt: string | null
}

export type InventoryListRequest = {
  warehouseId?: string
  productType?: ProductType
  q?: string
  page?: number
  pageSize?: number
}

export type InventoryListResponse = {
  balances: InventoryBalance[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export type InventoryAdjustment = {
  id: string
  warehouseId: string
  warehouseName: string
  productId: string
  productName: string
  productType: ProductType
  unit: ProductUnit
  previousQuantity: string
  newQuantity: string
  delta: string
  reason: string
  sourceType: 'manual' | 'purchase'
  purchaseOrderId: string | null
  createdByUserId: string
  createdByUserName: string
  createdAt: string
}

export type InventoryAdjustmentsListRequest = {
  warehouseId?: string
  productId?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export type InventoryAdjustmentsListResponse = {
  adjustments: InventoryAdjustment[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export type Supplier = {
  id: string
  name: string
  taxId: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type SuppliersStatusFilter = 'active' | 'inactive' | 'all'

export type SuppliersListRequest = {
  q?: string
  status?: SuppliersStatusFilter
  page?: number
  pageSize?: number
}

export type SuppliersListResponse = {
  suppliers: Supplier[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export type SupplierMutationInput = {
  name: string
  taxId?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
}

export type PurchaseItem = {
  id: string
  productId: string
  productName: string
  unit: ProductUnit
  quantity: string
  unitCost: string
  lineTotal: string
}

export type Purchase = {
  id: string
  supplierId: string
  supplierName: string
  warehouseId: string
  warehouseName: string
  invoiceNumber: string
  purchaseDate: string
  paymentMethod: string
  notes: string | null
  totalAmount: string
  createdByUserId: string
  createdByUserName: string
  createdAt: string
  updatedAt: string
}

export type PurchaseDetail = Purchase & {
  items: PurchaseItem[]
}

export type PurchasesListRequest = {
  q?: string
  supplierId?: string
  warehouseId?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export type PurchasesListResponse = {
  purchases: Purchase[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export type PurchaseMutationInput = {
  supplierId: string
  warehouseId: string
  invoiceNumber: string
  purchaseDate: string
  paymentMethod: string
  notes?: string | null
  items: Array<{
    productId: string
    quantity: number
    unitCost: number
  }>
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

export async function getUserOrganizations(token: string) {
  return apiRequest<OrganizationMembershipListResponse>('/api/auth/organizations', { method: 'GET' }, token)
}

export async function switchOrganization(input: AuthSwitchOrganizationRequest, token: string) {
  return apiRequest<AuthSwitchOrganizationResponse>(
    '/api/auth/switch-organization',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function getOrganizationMembers(token: string) {
  return apiRequest<OrganizationMembersResponse>('/api/organization/members', { method: 'GET' }, token)
}

export async function addOrganizationMember(
  input: { email: string; role: 'operator' | 'viewer' },
  token: string,
) {
  return apiRequest<{ member: { userId: string; fullName: string; email: string; role: MemberRole } }>(
    '/api/organization/members',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateOrganizationMemberRole(
  input: { userId: string; role: 'admin' | 'operator' | 'viewer' },
  token: string,
) {
  return apiRequest<{ member: { userId: string; role: MemberRole } }>(
    `/api/organization/members/${input.userId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ role: input.role }),
    },
    token,
  )
}

export async function revokeOrganizationMember(userId: string, token: string) {
  return apiRequest<void>(`/api/organization/members/${userId}`, { method: 'DELETE' }, token)
}

export async function getProducts(query: ProductsListRequest, token: string) {
  const searchParams = new URLSearchParams()

  if (query.q) {
    searchParams.set('q', query.q)
  }
  if (query.status) {
    searchParams.set('status', query.status)
  }
  if (query.productType) {
    searchParams.set('productType', query.productType)
  }
  if (query.page !== undefined) {
    searchParams.set('page', String(query.page))
  }
  if (query.pageSize !== undefined) {
    searchParams.set('pageSize', String(query.pageSize))
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return apiRequest<ProductsListResponse>(`/api/products${suffix}`, { method: 'GET' }, token)
}

export async function getProductById(productId: string, token: string) {
  return apiRequest<{ product: Product }>(`/api/products/${productId}`, { method: 'GET' }, token)
}

export async function createProduct(input: ProductMutationInput, token: string) {
  return apiRequest<{ product: Product }>(
    '/api/products',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateProduct(
  productId: string,
  input: Partial<ProductMutationInput>,
  token: string,
) {
  return apiRequest<{ product: Product }>(
    `/api/products/${productId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateProductStatus(productId: string, isActive: boolean, token: string) {
  return apiRequest<{ product: Product }>(
    `/api/products/${productId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    },
    token,
  )
}

export async function getProductCategories(status: ProductCategoriesStatusFilter, token: string) {
  const searchParams = new URLSearchParams({ status })

  return apiRequest<ProductCategoriesListResponse>(
    `/api/product-categories?${searchParams.toString()}`,
    { method: 'GET' },
    token,
  )
}

export async function createProductCategory(input: { name: string }, token: string) {
  return apiRequest<{ category: ProductCategory }>(
    '/api/product-categories',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateProductCategory(categoryId: string, input: { name: string }, token: string) {
  return apiRequest<{ category: ProductCategory }>(
    `/api/product-categories/${categoryId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateProductCategoryStatus(categoryId: string, isActive: boolean, token: string) {
  return apiRequest<{ category: ProductCategory }>(
    `/api/product-categories/${categoryId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    },
    token,
  )
}

export async function getWarehouses(status: WarehousesStatusFilter, token: string) {
  const searchParams = new URLSearchParams({ status })

  return apiRequest<WarehousesListResponse>(`/api/warehouses?${searchParams.toString()}`, { method: 'GET' }, token)
}

export async function createWarehouse(input: { name: string }, token: string) {
  return apiRequest<{ warehouse: Warehouse }>(
    '/api/warehouses',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateWarehouse(warehouseId: string, input: { name: string }, token: string) {
  return apiRequest<{ warehouse: Warehouse }>(
    `/api/warehouses/${warehouseId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateWarehouseStatus(warehouseId: string, isActive: boolean, token: string) {
  return apiRequest<{ warehouse: Warehouse }>(
    `/api/warehouses/${warehouseId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    },
    token,
  )
}

export async function getInventoryBalances(query: InventoryListRequest, token: string) {
  const searchParams = new URLSearchParams()

  if (query.warehouseId) {
    searchParams.set('warehouseId', query.warehouseId)
  }
  if (query.productType) {
    searchParams.set('productType', query.productType)
  }
  if (query.q) {
    searchParams.set('q', query.q)
  }
  if (query.page !== undefined) {
    searchParams.set('page', String(query.page))
  }
  if (query.pageSize !== undefined) {
    searchParams.set('pageSize', String(query.pageSize))
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return apiRequest<InventoryListResponse>(`/api/inventory${suffix}`, { method: 'GET' }, token)
}

export async function createInventoryAdjustment(
  input: { warehouseId: string; productId: string; newQuantity: number; reason: string },
  token: string,
) {
  return apiRequest<{
    balance: {
      id: string
      organizationId: string
      warehouseId: string
      productId: string
      quantity: string
      updatedAt: string
    }
    adjustment: {
      id: string
      organizationId: string
      warehouseId: string
      productId: string
      previousQuantity: string
      newQuantity: string
      delta: string
      reason: string
      createdByUserId: string
      createdAt: string
    }
  }>(
    '/api/inventory/adjustments',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function getInventoryAdjustments(query: InventoryAdjustmentsListRequest, token: string) {
  const searchParams = new URLSearchParams()

  if (query.warehouseId) {
    searchParams.set('warehouseId', query.warehouseId)
  }
  if (query.productId) {
    searchParams.set('productId', query.productId)
  }
  if (query.from) {
    searchParams.set('from', query.from)
  }
  if (query.to) {
    searchParams.set('to', query.to)
  }
  if (query.page !== undefined) {
    searchParams.set('page', String(query.page))
  }
  if (query.pageSize !== undefined) {
    searchParams.set('pageSize', String(query.pageSize))
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return apiRequest<InventoryAdjustmentsListResponse>(`/api/inventory/adjustments${suffix}`, { method: 'GET' }, token)
}

export async function getSuppliers(query: SuppliersListRequest, token: string) {
  const searchParams = new URLSearchParams()

  if (query.q) {
    searchParams.set('q', query.q)
  }
  if (query.status) {
    searchParams.set('status', query.status)
  }
  if (query.page !== undefined) {
    searchParams.set('page', String(query.page))
  }
  if (query.pageSize !== undefined) {
    searchParams.set('pageSize', String(query.pageSize))
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return apiRequest<SuppliersListResponse>(`/api/suppliers${suffix}`, { method: 'GET' }, token)
}

export async function createSupplier(input: SupplierMutationInput, token: string) {
  return apiRequest<{ supplier: Supplier }>(
    '/api/suppliers',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateSupplier(
  supplierId: string,
  input: Partial<SupplierMutationInput>,
  token: string,
) {
  return apiRequest<{ supplier: Supplier }>(
    `/api/suppliers/${supplierId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateSupplierStatus(supplierId: string, isActive: boolean, token: string) {
  return apiRequest<{ supplier: Supplier }>(
    `/api/suppliers/${supplierId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    },
    token,
  )
}

export async function getPurchases(query: PurchasesListRequest, token: string) {
  const searchParams = new URLSearchParams()

  if (query.q) {
    searchParams.set('q', query.q)
  }
  if (query.supplierId) {
    searchParams.set('supplierId', query.supplierId)
  }
  if (query.warehouseId) {
    searchParams.set('warehouseId', query.warehouseId)
  }
  if (query.from) {
    searchParams.set('from', query.from)
  }
  if (query.to) {
    searchParams.set('to', query.to)
  }
  if (query.page !== undefined) {
    searchParams.set('page', String(query.page))
  }
  if (query.pageSize !== undefined) {
    searchParams.set('pageSize', String(query.pageSize))
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return apiRequest<PurchasesListResponse>(`/api/purchases${suffix}`, { method: 'GET' }, token)
}

export async function getPurchaseById(purchaseId: string, token: string) {
  return apiRequest<{ purchase: PurchaseDetail }>(`/api/purchases/${purchaseId}`, { method: 'GET' }, token)
}

export async function createPurchase(input: PurchaseMutationInput, token: string) {
  return apiRequest<{
    purchase: PurchaseDetail
    stockChanges: Array<{
      productId: string
      previousQuantity: string
      newQuantity: string
      delta: string
      resultingCost: string
    }>
  }>(
    '/api/purchases',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}
