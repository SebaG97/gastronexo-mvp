import { z } from 'zod'
import type { DbClient } from '../../db/transaction.js'
import { aggregateByProduct, type StockShortage } from '../inventory/stock-ledger.js'

// Logica compartida del motor de pedidos: la usan la consola (orders.routes) y la tienda publica
// (public.routes). Precios, cortes, subtotales y numeracion se resuelven solo aca.
export const orderStatuses = ['new', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'] as const
export type OrderStatus = (typeof orderStatuses)[number]

export const editableStatuses: OrderStatus[] = ['new', 'confirmed']
export const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered'],
  delivered: [],
  cancelled: [],
}

export const orderItemSchema = z.object({
  productId: z.string().uuid(),
  cutTypeId: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().positive(),
})

// Estados en los que el pedido mantiene stock reservado en su deposito.
export const reservedStatuses: OrderStatus[] = ['confirmed', 'preparing', 'ready']

export type OrderItemInput = z.infer<typeof orderItemSchema>

type ProductRow = {
  id: string
  name: string
  unit: string
  isActive: boolean
  isSellable: boolean
  isCatalogVisible: boolean
  salePrice: string | null
}

type CutOptionRow = {
  productId: string
  cutTypeId: string
  cutTypeName: string
  isDefault: boolean
  priceModifier: string
}

export function toIsoDate(value: Date | undefined) {
  return (value ?? new Date()).toISOString().slice(0, 10)
}

export function nullableIsoDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null
}

export function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export async function getNextOrderNumber(client: DbClient, organizationId: string) {
  const result = await client.query<{ nextNumber: number }>(
    `INSERT INTO order_number_sequences (organization_id, last_number)
     VALUES ($1, 1)
     ON CONFLICT (organization_id)
     DO UPDATE SET last_number = order_number_sequences.last_number + 1
     RETURNING last_number AS "nextNumber"`,
    [organizationId],
  )

  return `PED-${String(result.rows[0].nextNumber).padStart(6, '0')}`
}

export async function ensureActiveCustomer(client: DbClient, organizationId: string, customerId: string) {
  const result = await client.query<{ id: string; isActive: boolean }>(
    `SELECT id, is_active AS "isActive"
     FROM customers
     WHERE organization_id = $1
       AND id = $2
     LIMIT 1`,
    [organizationId, customerId],
  )

  const customer = result.rows[0]
  if (!customer) {
    return { ok: false as const, statusCode: 404, message: 'Cliente no encontrado.' }
  }

  if (!customer.isActive) {
    return { ok: false as const, statusCode: 400, message: 'No se puede crear un pedido con un cliente inactivo.' }
  }

  return { ok: true as const }
}

// Unidades que solo se venden por cantidades enteras en la tienda.
export const wholeUnits = new Set(['unit', 'box', 'portion'])

export type PrepareOrderItemsOptions = {
  /** Tienda publica: solo productos visibles en catalogo y cantidades enteras para unidades. */
  storefront?: boolean
}

export async function prepareOrderItems(
  client: DbClient,
  organizationId: string,
  items: OrderItemInput[],
  options: PrepareOrderItemsOptions = {},
) {
  const productIds = [...new Set(items.map((item) => item.productId))]
  const productsResult = await client.query<ProductRow>(
    `SELECT
       id,
       name,
       unit,
       is_active AS "isActive",
       is_sellable AS "isSellable",
       is_catalog_visible AS "isCatalogVisible",
       sale_price::text AS "salePrice"
     FROM products
     WHERE organization_id = $1
       AND id = ANY($2::uuid[])`,
    [organizationId, productIds],
  )

  if (productsResult.rows.length !== productIds.length) {
    return { ok: false as const, statusCode: 404, message: 'Producto no encontrado.' }
  }

  const productsById = new Map(productsResult.rows.map((product) => [product.id, product]))
  const cutOptionsResult = await client.query<CutOptionRow>(
    `SELECT
       pco.product_id AS "productId",
       pco.cut_type_id AS "cutTypeId",
       ct.name AS "cutTypeName",
       pco.is_default AS "isDefault",
       pco.price_modifier::text AS "priceModifier"
     FROM product_cut_options pco
     JOIN cut_types ct
       ON ct.id = pco.cut_type_id
      AND ct.organization_id = pco.organization_id
      AND ct.is_active = true
     WHERE pco.organization_id = $1
       AND pco.product_id = ANY($2::uuid[])
       AND pco.is_active = true`,
    [organizationId, productIds],
  )

  const cutOptionsByProductId = new Map<string, CutOptionRow[]>()
  for (const option of cutOptionsResult.rows) {
    const options = cutOptionsByProductId.get(option.productId) ?? []
    options.push(option)
    cutOptionsByProductId.set(option.productId, options)
  }

  const preparedItems = []
  for (const item of items) {
    const product = productsById.get(item.productId)
    if (!product || !product.isActive) {
      return { ok: false as const, statusCode: 400, message: 'Solo se pueden vender productos activos.' }
    }

    if (!product.isSellable) {
      return { ok: false as const, statusCode: 400, message: 'Solo se pueden vender productos marcados como vendibles.' }
    }

    if (options.storefront && !product.isCatalogVisible) {
      return { ok: false as const, statusCode: 400, message: `${product.name} ya no está disponible en la tienda.` }
    }

    if (options.storefront && wholeUnits.has(product.unit) && !Number.isInteger(item.quantity)) {
      return { ok: false as const, statusCode: 400, message: `${product.name} se vende por unidades enteras.` }
    }

    const salePrice = Number(product.salePrice)
    if (!product.salePrice || !Number.isFinite(salePrice) || salePrice <= 0) {
      return { ok: false as const, statusCode: 400, message: 'El producto vendible debe tener precio de venta mayor a 0.' }
    }

    const cutOptions = cutOptionsByProductId.get(product.id) ?? []
    const requestedCutTypeId = item.cutTypeId ?? null
    let selectedCutOption: CutOptionRow | null = null

    if (cutOptions.length > 0) {
      if (!requestedCutTypeId) {
        return { ok: false as const, statusCode: 400, message: 'Seleccioná un corte activo del producto.' }
      }

      selectedCutOption =
        cutOptions.find((option) => option.cutTypeId === requestedCutTypeId) ?? null

      if (!selectedCutOption) {
        return { ok: false as const, statusCode: 400, message: 'El corte seleccionado no está activo o no pertenece al producto.' }
      }
    } else if (requestedCutTypeId) {
      return { ok: false as const, statusCode: 400, message: 'El producto seleccionado no tiene opciones de corte activas.' }
    }

    const cutPriceModifier = Number(selectedCutOption?.priceModifier ?? 0)
    const effectiveUnitPrice = Number((salePrice + cutPriceModifier).toFixed(2))
    const subtotal = Number((item.quantity * effectiveUnitPrice).toFixed(2))

    preparedItems.push({
      productId: product.id,
      cutTypeId: selectedCutOption?.cutTypeId ?? null,
      quantity: Number(item.quantity.toFixed(3)),
      unitPrice: salePrice,
      cutPriceModifier,
      subtotal,
      productNameSnapshot: product.name,
      productUnitSnapshot: product.unit,
      cutNameSnapshot: selectedCutOption?.cutTypeName ?? null,
    })
  }

  const subtotal = Number(
    preparedItems.reduce((accumulator, item) => accumulator + item.subtotal, 0).toFixed(2),
  )

  return { ok: true as const, preparedItems, subtotal, total: subtotal }
}

export async function replaceOrderItems(
  client: DbClient,
  organizationId: string,
  orderId: string,
  items: OrderItemInput[],
  options: PrepareOrderItemsOptions = {},
) {
  const prepared = await prepareOrderItems(client, organizationId, items, options)
  if (!prepared.ok) {
    return prepared
  }

  await client.query('DELETE FROM order_items WHERE organization_id = $1 AND order_id = $2', [
    organizationId,
    orderId,
  ])

  const itemRowsSql = prepared.preparedItems
    .map(
      (_item, index) =>
        `($1, $2, $${index * 9 + 3}, $${index * 9 + 4}, $${index * 9 + 5}, $${index * 9 + 6}, $${index * 9 + 7}, $${index * 9 + 8}, $${index * 9 + 9}, $${index * 9 + 10}, $${index * 9 + 11})`,
    )
    .join(', ')

  const itemParams: Array<string | number | null> = [orderId, organizationId]
  for (const item of prepared.preparedItems) {
    itemParams.push(
      item.productId,
      item.cutTypeId,
      item.quantity,
      item.unitPrice,
      item.cutPriceModifier,
      item.subtotal,
      item.productNameSnapshot,
      item.productUnitSnapshot,
      item.cutNameSnapshot,
    )
  }

  await client.query(
    `INSERT INTO order_items (
       order_id,
       organization_id,
       product_id,
       cut_type_id,
       quantity,
       unit_price,
       cut_price_modifier,
       subtotal,
       product_name_snapshot,
       product_unit_snapshot,
       cut_name_snapshot
     )
     VALUES ${itemRowsSql}`,
    itemParams,
  )

  return prepared
}

export async function getOrderStockRequirements(client: DbClient, organizationId: string, orderId: string) {
  const result = await client.query<{ productId: string; quantity: string }>(
    `SELECT product_id AS "productId", quantity::text AS quantity
     FROM order_items
     WHERE organization_id = $1
       AND order_id = $2`,
    [organizationId, orderId],
  )

  return aggregateByProduct(result.rows)
}

export async function findWarehouseForOrder(client: DbClient, organizationId: string, warehouseId: string) {
  const result = await client.query<{ id: string; name: string; isActive: boolean }>(
    `SELECT id, name, is_active AS "isActive"
     FROM warehouses
     WHERE organization_id = $1
       AND id = $2
     LIMIT 1`,
    [organizationId, warehouseId],
  )

  const warehouse = result.rows[0]
  if (!warehouse) {
    return { ok: false as const, statusCode: 404, message: 'Depósito no encontrado.' }
  }

  if (!warehouse.isActive) {
    return { ok: false as const, statusCode: 400, message: 'No se puede reservar stock en un depósito inactivo.' }
  }

  return { ok: true as const, warehouse }
}

export async function getWarehouseName(client: DbClient, organizationId: string, warehouseId: string) {
  const result = await client.query<{ name: string }>(
    'SELECT name FROM warehouses WHERE organization_id = $1 AND id = $2',
    [organizationId, warehouseId],
  )

  return result.rows[0]?.name ?? ''
}

export function insufficientStockBody(warehouseId: string, warehouseName: string, shortages: StockShortage[]) {
  return {
    message: `Stock insuficiente en ${warehouseName} para ${shortages.length === 1 ? 'un producto' : `${shortages.length} productos`} del pedido.`,
    code: 'insufficient_stock',
    warehouseId,
    warehouseName,
    shortages,
  }
}

export async function getOrderById(client: DbClient, organizationId: string, orderId: string) {
  const orderResult = await client.query(
    `SELECT
       o.id,
       o.order_number AS "orderNumber",
       o.customer_id AS "customerId",
       c.name AS "customerName",
       c.business_name AS "customerBusinessName",
       c.document_number AS "customerDocumentNumber",
       c.phone AS "customerPhone",
       c.email AS "customerEmail",
       o.status,
       o.order_date AS "orderDate",
       o.requested_delivery_date AS "requestedDeliveryDate",
       o.notes,
       o.subtotal::text AS subtotal,
       o.delivery_fee::text AS "deliveryFee",
       o.total::text AS total,
       o.warehouse_id AS "warehouseId",
       w.name AS "warehouseName",
       o.delivered_at AS "deliveredAt",
       o.channel,
       o.fulfillment_type AS "fulfillmentType",
       o.delivery_zone_id AS "deliveryZoneId",
       o.delivery_zone_name AS "deliveryZoneName",
       o.delivery_address AS "deliveryAddress",
       o.delivery_reference AS "deliveryReference",
       o.payment_method AS "paymentMethod",
       o.cash_change_for::text AS "cashChangeFor",
       o.contact_name AS "contactName",
       o.contact_phone AS "contactPhone",
       o.contact_email AS "contactEmail",
       o.created_by AS "createdBy",
       u.full_name AS "createdByUserName",
       o.created_at AS "createdAt",
       o.updated_at AS "updatedAt"
     FROM orders o
     JOIN customers c
       ON c.id = o.customer_id
      AND c.organization_id = o.organization_id
     LEFT JOIN warehouses w
       ON w.id = o.warehouse_id
      AND w.organization_id = o.organization_id
     LEFT JOIN users u ON u.id = o.created_by
     WHERE o.organization_id = $1
       AND o.id = $2
     LIMIT 1`,
    [organizationId, orderId],
  )

  const order = orderResult.rows[0]
  if (!order) {
    return null
  }

  const itemsResult = await client.query(
    `SELECT
       id,
       product_id AS "productId",
       cut_type_id AS "cutTypeId",
       quantity::text AS quantity,
       unit_price::text AS "unitPrice",
       cut_price_modifier::text AS "cutPriceModifier",
       subtotal::text,
       product_name_snapshot AS "productNameSnapshot",
       product_unit_snapshot AS "productUnitSnapshot",
       cut_name_snapshot AS "cutNameSnapshot",
       created_at AS "createdAt"
     FROM order_items
     WHERE organization_id = $1
       AND order_id = $2
     ORDER BY created_at ASC`,
    [organizationId, orderId],
  )

  const historyResult = await client.query(
    `SELECT
       osh.id,
       osh.from_status AS "fromStatus",
       osh.to_status AS "toStatus",
       osh.changed_by AS "changedBy",
       u.full_name AS "changedByUserName",
       osh.note,
       osh.created_at AS "createdAt"
     FROM order_status_history osh
     LEFT JOIN users u ON u.id = osh.changed_by
     WHERE osh.order_id = $1
     ORDER BY osh.created_at ASC`,
    [orderId],
  )

  return {
    ...order,
    items: itemsResult.rows,
    history: historyResult.rows,
  }
}
