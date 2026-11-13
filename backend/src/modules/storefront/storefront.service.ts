import { randomBytes } from 'node:crypto'
import type { DbClient } from '../../db/transaction.js'
import { wholeUnits, type OrderItemInput } from '../orders/orders.service.js'

export const paymentMethods = ['cash', 'transfer', 'card_on_delivery'] as const
export type PaymentMethod = (typeof paymentMethods)[number]

// Debajo de este disponible el producto se muestra como "ultimas unidades".
const LAST_UNITS_THRESHOLD = 5

export type StoreRow = {
  organizationId: string
  organizationName: string
  slug: string
  isEnabled: boolean
  displayName: string | null
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
}

export type DeliveryZoneRow = {
  id: string
  name: string
  fee: string
  isActive: boolean
  sortOrder: number
}

const storeColumns = `
  o.id AS "organizationId",
  o.name AS "organizationName",
  o.slug,
  COALESCE(s.is_enabled, false) AS "isEnabled",
  s.display_name AS "displayName",
  s.tagline,
  s.contact_phone AS "contactPhone",
  s.whatsapp_phone AS "whatsappPhone",
  s.contact_email AS "contactEmail",
  s.pickup_address AS "pickupAddress",
  s.opening_hours AS "openingHours",
  s.cutoff_notice AS "cutoffNotice",
  COALESCE(s.min_order_amount, 0)::text AS "minOrderAmount",
  COALESCE(s.allows_pickup, true) AS "allowsPickup",
  COALESCE(s.allows_delivery, true) AS "allowsDelivery",
  COALESCE(s.payment_methods, ARRAY['cash', 'transfer']::text[]) AS "paymentMethods",
  s.transfer_details AS "transferDetails"`

export async function getStoreByOrganizationId(client: DbClient, organizationId: string) {
  const result = await client.query<StoreRow>(
    `SELECT ${storeColumns}
     FROM organizations o
     LEFT JOIN storefront_settings s ON s.organization_id = o.id
     WHERE o.id = $1`,
    [organizationId],
  )
  return result.rows[0] ?? null
}

/** Tienda habilitada por slug. Deshabilitada o inexistente: null (la ruta responde 404). */
export async function getEnabledStoreBySlug(client: DbClient, slug: string) {
  const result = await client.query<StoreRow>(
    `SELECT ${storeColumns}
     FROM organizations o
     JOIN storefront_settings s ON s.organization_id = o.id
     WHERE o.slug = $1
       AND s.is_enabled = true`,
    [slug],
  )
  return result.rows[0] ?? null
}

export async function getDeliveryZones(client: DbClient, organizationId: string, onlyActive: boolean) {
  const result = await client.query<DeliveryZoneRow>(
    `SELECT id, name, fee::text AS fee, is_active AS "isActive", sort_order AS "sortOrder"
     FROM delivery_zones
     WHERE organization_id = $1
       ${onlyActive ? 'AND is_active = true' : ''}
     ORDER BY sort_order ASC, name ASC`,
    [organizationId],
  )
  return result.rows
}

export function publicStore(store: StoreRow, zones: DeliveryZoneRow[]) {
  return {
    slug: store.slug,
    name: store.displayName || store.organizationName,
    tagline: store.tagline,
    contactPhone: store.contactPhone,
    whatsappPhone: store.whatsappPhone,
    contactEmail: store.contactEmail,
    pickupAddress: store.pickupAddress,
    openingHours: store.openingHours,
    cutoffNotice: store.cutoffNotice,
    minOrderAmount: store.minOrderAmount,
    allowsPickup: store.allowsPickup,
    allowsDelivery: store.allowsDelivery && zones.length > 0,
    paymentMethods: store.paymentMethods,
    transferDetails: store.transferDetails,
    deliveryZones: zones.map((zone) => ({ id: zone.id, name: zone.name, fee: zone.fee })),
  }
}

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, '')
}

export function createPublicToken() {
  return randomBytes(18).toString('base64url')
}

export type Availability = 'available' | 'last_units' | 'out_of_stock'

export function availabilityFrom(available: number): Availability {
  if (available <= 0) {
    return 'out_of_stock'
  }
  return available <= LAST_UNITS_THRESHOLD ? 'last_units' : 'available'
}

/** Disponible = suma de (cantidad - reservado) en depositos activos. Nunca se expone el numero. */
export const availableStockSql = `
  COALESCE((
    SELECT SUM(ib.quantity - ib.reserved_quantity)
    FROM inventory_balances ib
    JOIN warehouses w ON w.id = ib.warehouse_id AND w.is_active = true
    WHERE ib.organization_id = p.organization_id
      AND ib.product_id = p.id
  ), 0)`

type QuoteProductRow = {
  id: string
  name: string
  unit: string
  imageUrl: string | null
  salePrice: string
  available: string
}

type QuoteCutRow = {
  productId: string
  cutTypeId: string
  cutTypeName: string
  priceModifier: string
}

export type QuoteItemStatus = 'ok' | 'unavailable' | 'out_of_stock' | 'invalid_quantity' | 'invalid_cut'

export type QuoteInput = {
  items: OrderItemInput[]
  fulfillmentType?: 'pickup' | 'delivery'
  deliveryZoneId?: string | null
}

function money(value: number) {
  return Number(value.toFixed(2))
}

/**
 * Cotizacion de un carrito con los precios vigentes. No escribe ni corta en el primer problema:
 * devuelve el estado de cada linea para que la tienda le muestre al cliente que cambio.
 */
export async function buildQuote(client: DbClient, store: StoreRow, input: QuoteInput) {
  const productIds = [...new Set(input.items.map((item) => item.productId))]
  const productsResult = await client.query<QuoteProductRow>(
    `SELECT
       p.id,
       p.name,
       p.unit,
       p.image_url AS "imageUrl",
       p.sale_price::text AS "salePrice",
       (${availableStockSql})::text AS available
     FROM products p
     WHERE p.organization_id = $1
       AND p.id = ANY($2::uuid[])
       AND p.is_active = true
       AND p.is_sellable = true
       AND p.is_catalog_visible = true
       AND p.sale_price > 0`,
    [store.organizationId, productIds],
  )
  const cutsResult = await client.query<QuoteCutRow>(
    `SELECT
       pco.product_id AS "productId",
       pco.cut_type_id AS "cutTypeId",
       ct.name AS "cutTypeName",
       pco.price_modifier::text AS "priceModifier"
     FROM product_cut_options pco
     JOIN cut_types ct
       ON ct.id = pco.cut_type_id
      AND ct.organization_id = pco.organization_id
      AND ct.is_active = true
     WHERE pco.organization_id = $1
       AND pco.product_id = ANY($2::uuid[])
       AND pco.is_active = true`,
    [store.organizationId, productIds],
  )

  const productsById = new Map(productsResult.rows.map((product) => [product.id, product]))
  const cutsByProduct = new Map<string, QuoteCutRow[]>()
  for (const cut of cutsResult.rows) {
    cutsByProduct.set(cut.productId, [...(cutsByProduct.get(cut.productId) ?? []), cut])
  }

  const items = input.items.map((item) => {
    const product = productsById.get(item.productId)
    const base = {
      productId: item.productId,
      cutTypeId: item.cutTypeId ?? null,
      quantity: item.quantity,
    }

    if (!product) {
      return { ...base, status: 'unavailable' as QuoteItemStatus, name: null, unit: null, imageUrl: null, cutName: null, unitPrice: null, subtotal: 0 }
    }

    const cuts = cutsByProduct.get(product.id) ?? []
    const cut = cuts.find((option) => option.cutTypeId === item.cutTypeId) ?? null
    const unitPrice = money(Number(product.salePrice) + Number(cut?.priceModifier ?? 0))
    const subtotal = money(item.quantity * unitPrice)

    let status: QuoteItemStatus = 'ok'
    if ((cuts.length > 0 && !cut) || (cuts.length === 0 && item.cutTypeId)) {
      status = 'invalid_cut'
    } else if (wholeUnits.has(product.unit) && !Number.isInteger(item.quantity)) {
      status = 'invalid_quantity'
    } else if (Number(product.available) <= 0) {
      status = 'out_of_stock'
    }

    return {
      ...base,
      status,
      name: product.name,
      unit: product.unit,
      imageUrl: product.imageUrl,
      cutName: cut?.cutTypeName ?? null,
      unitPrice,
      subtotal: status === 'ok' ? subtotal : 0,
      availability: availabilityFrom(Number(product.available)),
    }
  })

  const subtotal = money(items.reduce((sum, item) => sum + item.subtotal, 0))

  let deliveryFee = 0
  let deliveryZone: { id: string; name: string } | null = null
  let fulfillmentError: string | null = null
  if (input.fulfillmentType === 'delivery') {
    if (!store.allowsDelivery) {
      fulfillmentError = 'Esta tienda no hace envíos.'
    } else if (input.deliveryZoneId) {
      const zones = await getDeliveryZones(client, store.organizationId, true)
      const zone = zones.find((candidate) => candidate.id === input.deliveryZoneId)
      if (zone) {
        deliveryFee = money(Number(zone.fee))
        deliveryZone = { id: zone.id, name: zone.name }
      } else {
        fulfillmentError = 'La zona de envío elegida ya no está disponible.'
      }
    }
  } else if (input.fulfillmentType === 'pickup' && !store.allowsPickup) {
    fulfillmentError = 'Esta tienda no tiene retiro en el local.'
  }

  const minOrderAmount = Number(store.minOrderAmount)

  return {
    items,
    subtotal,
    deliveryFee,
    deliveryZone,
    total: money(subtotal + deliveryFee),
    minOrderAmount,
    meetsMinimum: subtotal >= minOrderAmount,
    hasIssues: items.some((item) => item.status !== 'ok') || fulfillmentError !== null,
    fulfillmentError,
  }
}

export type Quote = Awaited<ReturnType<typeof buildQuote>>

/**
 * Cliente de la tienda: se identifica por telefono normalizado. Si no existe se crea; si su
 * nombre choca con otro cliente (indice unico por nombre) se le agregan los ultimos 4 digitos.
 */
export async function upsertStorefrontCustomer(
  client: DbClient,
  organizationId: string,
  contact: { name: string; phone: string; email: string | null },
) {
  const phoneNormalized = normalizePhone(contact.phone)
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM customers
     WHERE organization_id = $1 AND phone_normalized = $2
     LIMIT 1`,
    [organizationId, phoneNormalized],
  )
  if (existing.rows[0]) {
    await client.query(
      `UPDATE customers
       SET email = COALESCE($3, email), is_active = true, updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, existing.rows[0].id, contact.email],
    )
    return existing.rows[0].id
  }

  const nameTaken = await client.query(
    'SELECT 1 FROM customers WHERE organization_id = $1 AND lower(name) = lower($2) LIMIT 1',
    [organizationId, contact.name],
  )
  const name = nameTaken.rowCount ? `${contact.name} (${phoneNormalized.slice(-4)})` : contact.name

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO customers (organization_id, name, phone, phone_normalized, email, notes)
     VALUES ($1, $2, $3, $4, $5, 'Creado desde la tienda online')
     ON CONFLICT (organization_id, phone_normalized) WHERE phone_normalized IS NOT NULL
     DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [organizationId, name, contact.phone, phoneNormalized, contact.email],
  )
  return inserted.rows[0].id
}
