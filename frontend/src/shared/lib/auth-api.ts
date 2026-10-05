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
  isSellable: boolean
  isCatalogVisible: boolean
  salePrice: string | number | null
  categoryId: string | null
  categoryName: string | null
  isActive: boolean
  createdAt: string
  cutOptions?: ProductCutOption[]
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

export type CutType = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CutTypesStatusFilter = 'active' | 'inactive' | 'all'

export type CutTypesListRequest = {
  q?: string
  status?: CutTypesStatusFilter
}

export type CutTypesListResponse = {
  cutTypes: CutType[]
}

export type CutTypeMutationInput = {
  name: string
  description?: string | null
}

export type ProductCutOption = {
  id: string
  productId: string
  cutTypeId: string
  cutTypeName: string
  cutTypeIsActive: boolean
  isDefault: boolean
  isActive: boolean
  priceModifier: string | number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type ProductCutOptionsListResponse = {
  cutOptions: ProductCutOption[]
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
  isSellable?: boolean
  isCatalogVisible?: boolean
  salePrice?: number | null
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
  reservedQuantity: string
  availableQuantity: string
  updatedAt: string | null
}

export type InventoryMovementType = 'purchase' | 'adjustment' | 'sale' | 'production'

export type InventoryMovement = {
  id: string
  warehouseId: string
  warehouseName: string
  productId: string
  productName: string
  productType: ProductType
  unit: ProductUnit
  movementType: InventoryMovementType
  quantityDelta: string
  balanceAfter: string
  sourceType:
    | 'purchase'
    | 'adjustment'
    | 'order_delivery'
    | 'production_consumption'
    | 'production_output'
    | 'production_void'
  sourceId: string
  sourceReference: string | null
  createdBy: string
  createdByUserName: string
  createdAt: string
}

export type InventoryMovementsListRequest = {
  warehouseId?: string
  productId?: string
  movementType?: InventoryMovementType
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export type InventoryMovementsListResponse = {
  movements: InventoryMovement[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
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

export type Customer = {
  id: string
  name: string
  businessName: string | null
  documentNumber: string | null
  phone: string | null
  email: string | null
  notes: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CustomersStatusFilter = 'active' | 'inactive' | 'all'

export type CustomersListRequest = {
  q?: string
  status?: CustomersStatusFilter
  page?: number
  pageSize?: number
}

export type CustomersListResponse = {
  customers: Customer[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export type CustomerMutationInput = {
  name: string
  businessName?: string | null
  documentNumber?: string | null
  phone?: string | null
  email?: string | null
  notes?: string | null
}

export type OrderStatus = 'new' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'

export type Order = {
  id: string
  orderNumber: string
  customerId: string
  customerName: string
  status: OrderStatus
  orderDate: string
  requestedDeliveryDate: string | null
  subtotal: string
  total: string
  itemCount: number
  warehouseId: string | null
  warehouseName: string | null
  deliveredAt: string | null
  createdAt: string
  updatedAt: string
}

export type StockShortage = {
  productId: string
  productName: string
  unit: ProductUnit
  requested: string
  available: string
  missing: string
}

export type InsufficientStockError = {
  message: string
  code: 'insufficient_stock'
  warehouseId: string
  warehouseName: string
  shortages: StockShortage[]
}

export type Sale = {
  id: string
  orderNumber: string
  customerId: string
  customerName: string
  orderDate: string
  deliveredAt: string
  warehouseId: string | null
  warehouseName: string | null
  total: string
  itemCount: number
}

export type SalesListRequest = {
  from?: string
  to?: string
  q?: string
  page?: number
  pageSize?: number
}

export type SalesListResponse = {
  sales: Sale[]
  summary: {
    count: number
    total: string
  }
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export type OrderItem = {
  id: string
  productId: string
  cutTypeId: string | null
  quantity: string
  unitPrice: string
  cutPriceModifier: string
  subtotal: string
  productNameSnapshot: string
  productUnitSnapshot: ProductUnit
  cutNameSnapshot: string | null
  createdAt: string
}

export type OrderHistoryEntry = {
  id: string
  fromStatus: OrderStatus | null
  toStatus: OrderStatus
  changedBy: string
  changedByUserName: string
  createdAt: string
}

export type OrderDetail = Omit<Order, 'itemCount'> & {
  customerBusinessName: string | null
  customerDocumentNumber: string | null
  customerPhone: string | null
  customerEmail: string | null
  notes: string | null
  createdBy: string
  createdByUserName: string
  items: OrderItem[]
  history: OrderHistoryEntry[]
}

export type OrdersListRequest = {
  q?: string
  status?: OrderStatus | 'all'
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export type OrdersListResponse = {
  orders: Order[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export type OrderMutationInput = {
  customerId: string
  orderDate?: string
  requestedDeliveryDate?: string | null
  notes?: string | null
  items: Array<{
    productId: string
    cutTypeId?: string | null
    quantity: number
  }>
}

export type OrderDetailResponse = {
  order: OrderDetail
  transitions: OrderStatus[]
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

export type RecipesStatusFilter = 'active' | 'inactive' | 'all'

export type Recipe = {
  id: string
  productId: string
  productName: string
  productUnit: ProductUnit
  yieldQuantity: string
  isActive: boolean
  notes: string | null
  itemCount: number
  createdAt: string
  updatedAt: string
}

export type RecipeItem = {
  id: string
  ingredientProductId: string
  productName: string
  unit: ProductUnit
  productType: ProductType
  isActive: boolean
  unitCost: string
  quantity: string
}

export type RecipeDetail = Omit<Recipe, 'itemCount'> & {
  productCost: string
  productIsActive: boolean
  createdByUserName: string
  updatedByUserName: string
  items: RecipeItem[]
}

export type RecipesListResponse = {
  recipes: Recipe[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export type RecipeMutationInput = {
  productId: string
  yieldQuantity: number
  notes?: string | null
  items: Array<{ ingredientProductId: string; quantity: number }>
}

export type ProductionRunStatus = 'completed' | 'voided'

export type ProductionRun = {
  id: string
  runNumber: string
  productId: string
  productName: string
  productUnit: ProductUnit
  recipeId: string
  recipeYieldQuantity: string
  warehouseId: string
  warehouseName: string
  quantityProduced: string
  unitCost: string
  totalCost: string
  status: ProductionRunStatus
  notes: string | null
  createdByUserName: string
  createdAt: string
  voidedAt: string | null
  voidedByUserName: string | null
  voidReason: string | null
}

export type ProductionRunDetail = ProductionRun & {
  items: Array<{
    id: string
    productId: string
    productName: string
    unit: ProductUnit
    quantity: string
    unitCost: string
    subtotal: string
  }>
}

export type ProductionRunsListRequest = {
  status?: ProductionRunStatus | 'all'
  q?: string
  page?: number
  pageSize?: number
}

export type ProductionRunsListResponse = {
  productionRuns: ProductionRun[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

export type ProductionInput = {
  productId: string
  warehouseId: string
  quantity: number
}

export type ProductionPreview = {
  productId: string
  productName: string
  productUnit: ProductUnit
  recipeYieldQuantity: string
  warehouseName: string
  quantity: string
  ingredients: Array<{
    productId: string
    productName: string
    unit: ProductUnit
    recipeQuantity: string
    required: string
    available: string
    missing: string
    isSufficient: boolean
    unitCost: string
    subtotal: string
  }>
  totalCost: string
  unitCost: string
  currentCost: string
  currentStock: string
  resultingCost: string
  canProduce: boolean
  shortages: StockShortage[]
}

export class ApiError extends Error {
  public readonly status: number
  public readonly payload: unknown

  constructor(status: number, message: string, payload: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

/** Detalle de stock insuficiente (409) devuelto al confirmar o editar un pedido. */
export function getInsufficientStockError(error: unknown): InsufficientStockError | null {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return null
  }

  const payload = error.payload
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'code' in payload &&
    payload.code === 'insufficient_stock' &&
    'shortages' in payload &&
    Array.isArray(payload.shortages)
  ) {
    return payload as InsufficientStockError
  }

  return null
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

    throw new ApiError(response.status, message, payload)
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

export async function getCutTypes(query: CutTypesListRequest, token: string) {
  const searchParams = new URLSearchParams()

  if (query.q) {
    searchParams.set('q', query.q)
  }
  if (query.status) {
    searchParams.set('status', query.status)
  }

  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
  return apiRequest<CutTypesListResponse>(`/api/cut-types${suffix}`, { method: 'GET' }, token)
}

export async function createCutType(input: CutTypeMutationInput, token: string) {
  return apiRequest<{ cutType: CutType }>(
    '/api/cut-types',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateCutType(cutTypeId: string, input: CutTypeMutationInput, token: string) {
  return apiRequest<{ cutType: CutType }>(
    `/api/cut-types/${cutTypeId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateCutTypeStatus(cutTypeId: string, isActive: boolean, token: string) {
  return apiRequest<{ cutType: CutType }>(
    `/api/cut-types/${cutTypeId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    },
    token,
  )
}

export async function getProductCutOptions(productId: string, token: string) {
  return apiRequest<ProductCutOptionsListResponse>(
    `/api/products/${productId}/cut-options`,
    { method: 'GET' },
    token,
  )
}

export async function createProductCutOption(
  productId: string,
  input: { cutTypeId: string; isDefault?: boolean; priceModifier?: number; sortOrder?: number },
  token: string,
) {
  return apiRequest<{ cutOption: ProductCutOption; cutOptions: ProductCutOption[] }>(
    `/api/products/${productId}/cut-options`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateProductCutOption(
  productId: string,
  optionId: string,
  input: { isDefault?: boolean; isActive?: boolean; priceModifier?: number; sortOrder?: number },
  token: string,
) {
  return apiRequest<{ cutOption: ProductCutOption; cutOptions: ProductCutOption[] }>(
    `/api/products/${productId}/cut-options/${optionId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
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

export async function getInventoryMovements(query: InventoryMovementsListRequest, token: string) {
  const searchParams = new URLSearchParams()

  if (query.warehouseId) {
    searchParams.set('warehouseId', query.warehouseId)
  }
  if (query.productId) {
    searchParams.set('productId', query.productId)
  }
  if (query.movementType) {
    searchParams.set('movementType', query.movementType)
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
  return apiRequest<InventoryMovementsListResponse>(`/api/inventory/movements${suffix}`, { method: 'GET' }, token)
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

export async function getRecipes(
  query: { status?: RecipesStatusFilter; q?: string; page?: number; pageSize?: number },
  token: string,
) {
  const searchParams = new URLSearchParams()

  if (query.status) {
    searchParams.set('status', query.status)
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
  return apiRequest<RecipesListResponse>(`/api/recipes${suffix}`, { method: 'GET' }, token)
}

export async function getRecipeById(recipeId: string, token: string) {
  return apiRequest<{ recipe: RecipeDetail }>(`/api/recipes/${recipeId}`, { method: 'GET' }, token)
}

export async function createRecipe(input: RecipeMutationInput, token: string) {
  return apiRequest<{ recipe: RecipeDetail }>(
    '/api/recipes',
    { method: 'POST', body: JSON.stringify(input) },
    token,
  )
}

export async function updateRecipe(
  recipeId: string,
  input: Partial<Omit<RecipeMutationInput, 'productId'>>,
  token: string,
) {
  return apiRequest<{ recipe: RecipeDetail }>(
    `/api/recipes/${recipeId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
    token,
  )
}

export async function updateRecipeStatus(recipeId: string, isActive: boolean, token: string) {
  return apiRequest<{ recipe: RecipeDetail }>(
    `/api/recipes/${recipeId}/status`,
    { method: 'PATCH', body: JSON.stringify({ isActive }) },
    token,
  )
}

export async function getProductionRuns(query: ProductionRunsListRequest, token: string) {
  const searchParams = new URLSearchParams()

  if (query.status) {
    searchParams.set('status', query.status)
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
  return apiRequest<ProductionRunsListResponse>(`/api/production-runs${suffix}`, { method: 'GET' }, token)
}

export async function getProductionRunById(runId: string, token: string) {
  return apiRequest<{ productionRun: ProductionRunDetail }>(
    `/api/production-runs/${runId}`,
    { method: 'GET' },
    token,
  )
}

export async function previewProductionRun(input: ProductionInput, token: string) {
  return apiRequest<{ preview: ProductionPreview }>(
    '/api/production-runs/preview',
    { method: 'POST', body: JSON.stringify(input) },
    token,
  )
}

export async function createProductionRun(input: ProductionInput & { notes?: string | null }, token: string) {
  return apiRequest<{ productionRun: ProductionRunDetail; resultingCost: string }>(
    '/api/production-runs',
    { method: 'POST', body: JSON.stringify(input) },
    token,
  )
}

export async function voidProductionRun(runId: string, reason: string | null, token: string) {
  return apiRequest<{ productionRun: ProductionRunDetail }>(
    `/api/production-runs/${runId}/void`,
    { method: 'POST', body: JSON.stringify({ reason }) },
    token,
  )
}

export async function getCustomers(query: CustomersListRequest, token: string) {
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
  return apiRequest<CustomersListResponse>(`/api/customers${suffix}`, { method: 'GET' }, token)
}

export async function createCustomer(input: CustomerMutationInput, token: string) {
  return apiRequest<{ customer: Customer }>(
    '/api/customers',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateCustomer(
  customerId: string,
  input: Partial<CustomerMutationInput>,
  token: string,
) {
  return apiRequest<{ customer: Customer }>(
    `/api/customers/${customerId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateCustomerStatus(customerId: string, isActive: boolean, token: string) {
  return apiRequest<{ customer: Customer }>(
    `/api/customers/${customerId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    },
    token,
  )
}

export async function getOrders(query: OrdersListRequest, token: string) {
  const searchParams = new URLSearchParams()

  if (query.q) {
    searchParams.set('q', query.q)
  }
  if (query.status) {
    searchParams.set('status', query.status)
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
  return apiRequest<OrdersListResponse>(`/api/orders${suffix}`, { method: 'GET' }, token)
}

export async function getOrderById(orderId: string, token: string) {
  return apiRequest<OrderDetailResponse>(`/api/orders/${orderId}`, { method: 'GET' }, token)
}

export async function createOrder(input: OrderMutationInput, token: string) {
  return apiRequest<OrderDetailResponse>(
    '/api/orders',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateOrder(orderId: string, input: Partial<OrderMutationInput>, token: string) {
  return apiRequest<OrderDetailResponse>(
    `/api/orders/${orderId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    token,
  )
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  token: string,
  warehouseId?: string,
) {
  return apiRequest<OrderDetailResponse>(
    `/api/orders/${orderId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify(warehouseId ? { status, warehouseId } : { status }),
    },
    token,
  )
}

export async function getSales(query: SalesListRequest, token: string) {
  const searchParams = new URLSearchParams()

  if (query.from) {
    searchParams.set('from', query.from)
  }
  if (query.to) {
    searchParams.set('to', query.to)
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
  return apiRequest<SalesListResponse>(`/api/sales${suffix}`, { method: 'GET' }, token)
}
