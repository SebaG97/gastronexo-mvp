const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export type PaymentMethod = 'cash' | 'transfer' | 'card_on_delivery'
export type FulfillmentType = 'pickup' | 'delivery'
export type Availability = 'available' | 'last_units' | 'out_of_stock'

export type Store = {
  slug: string
  name: string
  tagline: string | null
  contactPhone: string | null
  whatsappPhone: string | null
  contactEmail: string | null
  pickupAddress: string | null
  openingHours: string | null
  cutoffNotice: string | null
  minOrderAmount: string
  allowsPickup: boolean
  allowsDelivery: boolean
  paymentMethods: PaymentMethod[]
  transferDetails: string | null
  deliveryZones: Array<{ id: string; name: string; fee: string }>
}

export type Category = { id: string; name: string; productCount: number }

export type CatalogProduct = {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  unit: string
  price: string
  categoryId: string | null
  categoryName: string | null
  availability: Availability
  cuts: Array<{ id: string; name: string; priceModifier: string; isDefault: boolean }>
}

export type CartItemInput = { productId: string; cutTypeId: string | null; quantity: number }

export type QuoteItemStatus = 'ok' | 'unavailable' | 'out_of_stock' | 'invalid_quantity' | 'invalid_cut'

export type Quote = {
  items: Array<
    CartItemInput & {
      status: QuoteItemStatus
      name: string | null
      unit: string | null
      cutName: string | null
      unitPrice: number | null
      subtotal: number
    }
  >
  subtotal: number
  deliveryFee: number
  deliveryZone: { id: string; name: string } | null
  total: number
  minOrderAmount: number
  meetsMinimum: boolean
  hasIssues: boolean
  fulfillmentError: string | null
}

export type CreateOrderInput = {
  contact: { name: string; phone: string; email: string | null }
  fulfillment: {
    type: FulfillmentType
    deliveryZoneId: string | null
    address: string | null
    reference: string | null
    requestedDate: string | null
  }
  payment: { method: PaymentMethod; cashChangeFor: number | null }
  notes: string | null
  items: CartItemInput[]
  expectedTotal: number
  website?: string
}

export type PublicOrder = {
  orderNumber: string
  status: 'new' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
  subtotal: string
  deliveryFee: string
  total: string
  fulfillmentType: FulfillmentType
  deliveryZoneName: string | null
  deliveryAddress: string | null
  requestedDeliveryDate: string | null
  paymentMethod: PaymentMethod
  cashChangeFor: string | null
  contactName: string
  notes: string | null
  createdAt: string
  items: Array<{ name: string; unit: string; cutName: string | null; quantity: string; unitPrice: string; subtotal: string }>
}

export class StoreApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly quote: Quote | null,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/api/public${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new StoreApiError(0, 'network', 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.', null)
  }

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      response.status === 503
        ? 'La tienda está con mucha demanda. Probá de nuevo en unos segundos.'
        : (body.message ?? 'Algo salió mal. Probá de nuevo.')
    throw new StoreApiError(response.status, body.code ?? null, message, body.quote ?? null)
  }
  return body as T
}

export const storeApi = {
  store: (slug: string) => request<{ store: Store }>(`/${slug}/store`),
  categories: (slug: string) => request<{ categories: Category[] }>(`/${slug}/categories`),
  products: (slug: string) => request<{ products: CatalogProduct[] }>(`/${slug}/products?pageSize=60`),
  quote: (
    slug: string,
    input: { items: CartItemInput[]; fulfillmentType?: FulfillmentType; deliveryZoneId?: string | null },
  ) => request<{ quote: Quote }>(`/${slug}/cart/quote`, { method: 'POST', body: JSON.stringify(input) }),
  createOrder: (slug: string, input: CreateOrderInput, idempotencyKey: string) =>
    request<{ order: { orderNumber: string; publicToken: string } }>(`/${slug}/orders`, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  order: (slug: string, token: string) => request<{ order: PublicOrder }>(`/${slug}/orders/${token}`),
}
