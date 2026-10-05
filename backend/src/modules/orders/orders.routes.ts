import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'
import {
  aggregateByProduct,
  consumeReservedStock,
  lockBalances,
  releaseStock,
  reserveStock,
  type StockShortage,
} from '../inventory/stock-ledger.js'

const orderStatuses = ['new', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'] as const
type OrderStatus = (typeof orderStatuses)[number]

const editableStatuses: OrderStatus[] = ['new', 'confirmed']
const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered'],
  delivered: [],
  cancelled: [],
}

const orderIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const listOrdersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum([...orderStatuses, 'all']).default('all'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const orderItemSchema = z.object({
  productId: z.string().uuid(),
  cutTypeId: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().positive(),
})

const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  orderDate: z.coerce.date().optional(),
  requestedDeliveryDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(600).nullable().optional(),
  items: z.array(orderItemSchema).min(1).max(300),
})

const updateOrderSchema = z
  .object({
    customerId: z.string().uuid().optional(),
    orderDate: z.coerce.date().optional(),
    requestedDeliveryDate: z.coerce.date().nullable().optional(),
    notes: z.string().trim().max(600).nullable().optional(),
    items: z.array(orderItemSchema).min(1).max(300).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar.',
  })

const updateOrderStatusSchema = z.object({
  status: z.enum(orderStatuses),
  warehouseId: z.string().uuid().optional(),
})

// Estados en los que el pedido mantiene stock reservado en su deposito.
const reservedStatuses: OrderStatus[] = ['confirmed', 'preparing', 'ready']

type DbClient = Pick<typeof pool, 'query'>

type OrderInput = z.infer<typeof createOrderSchema>
type OrderItemInput = z.infer<typeof orderItemSchema>

type ProductRow = {
  id: string
  name: string
  unit: string
  isActive: boolean
  isSellable: boolean
  salePrice: string | null
}

type CutOptionRow = {
  productId: string
  cutTypeId: string
  cutTypeName: string
  isDefault: boolean
  priceModifier: string
}

function toIsoDate(value: Date | undefined) {
  return (value ?? new Date()).toISOString().slice(0, 10)
}

function nullableIsoDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

async function rollbackTransaction(client: DbClient) {
  try {
    await client.query('ROLLBACK')
  } catch {
    return
  }
}

async function getNextOrderNumber(client: DbClient, organizationId: string) {
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

async function ensureActiveCustomer(client: DbClient, organizationId: string, customerId: string) {
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

async function prepareOrderItems(client: DbClient, organizationId: string, items: OrderItemInput[]) {
  const productIds = [...new Set(items.map((item) => item.productId))]
  const productsResult = await client.query<ProductRow>(
    `SELECT
       id,
       name,
       unit,
       is_active AS "isActive",
       is_sellable AS "isSellable",
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

    const salePrice = Number(product.salePrice)
    if (!product.salePrice || !Number.isFinite(salePrice) || salePrice <= 0) {
      return { ok: false as const, statusCode: 400, message: 'El producto vendible debe tener precio de venta mayor a 0.' }
    }

    const cutOptions = cutOptionsByProductId.get(product.id) ?? []
    const requestedCutTypeId = item.cutTypeId ?? null
    let selectedCutOption: CutOptionRow | null = null

    if (cutOptions.length > 0) {
      if (!requestedCutTypeId) {
        return { ok: false as const, statusCode: 400, message: 'Selecciona un corte activo asociado al producto.' }
      }

      selectedCutOption =
        cutOptions.find((option) => option.cutTypeId === requestedCutTypeId) ?? null

      if (!selectedCutOption) {
        return { ok: false as const, statusCode: 400, message: 'El corte seleccionado no esta activo o no pertenece al producto.' }
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

async function replaceOrderItems(
  client: DbClient,
  organizationId: string,
  orderId: string,
  items: OrderItemInput[],
) {
  const prepared = await prepareOrderItems(client, organizationId, items)
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

async function getOrderStockRequirements(client: DbClient, organizationId: string, orderId: string) {
  const result = await client.query<{ productId: string; quantity: string }>(
    `SELECT product_id AS "productId", quantity::text AS quantity
     FROM order_items
     WHERE organization_id = $1
       AND order_id = $2`,
    [organizationId, orderId],
  )

  return aggregateByProduct(result.rows)
}

async function findWarehouseForOrder(client: DbClient, organizationId: string, warehouseId: string) {
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

async function getWarehouseName(client: DbClient, organizationId: string, warehouseId: string) {
  const result = await client.query<{ name: string }>(
    'SELECT name FROM warehouses WHERE organization_id = $1 AND id = $2',
    [organizationId, warehouseId],
  )

  return result.rows[0]?.name ?? ''
}

function insufficientStockBody(warehouseId: string, warehouseName: string, shortages: StockShortage[]) {
  return {
    message: `Stock insuficiente en ${warehouseName} para ${shortages.length === 1 ? 'un producto' : `${shortages.length} productos`} del pedido.`,
    code: 'insufficient_stock',
    warehouseId,
    warehouseName,
    shortages,
  }
}

async function getOrderById(client: DbClient, organizationId: string, orderId: string) {
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
       o.total::text AS total,
       o.warehouse_id AS "warehouseId",
       w.name AS "warehouseName",
       o.delivered_at AS "deliveredAt",
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
     JOIN users u ON u.id = o.created_by
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
       osh.created_at AS "createdAt"
     FROM order_status_history osh
     JOIN users u ON u.id = osh.changed_by
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

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => {
      const query = listOrdersQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id
      const page = query.page
      const pageSize = query.pageSize

      const whereClauses = ['o.organization_id = $1']
      const params: Array<string | number | Date> = [organizationId]

      if (query.status !== 'all') {
        params.push(query.status)
        whereClauses.push(`o.status = $${params.length}`)
      }
      if (query.from) {
        params.push(query.from)
        whereClauses.push(`o.order_date >= $${params.length}`)
      }
      if (query.to) {
        params.push(query.to)
        whereClauses.push(`o.order_date <= $${params.length}`)
      }
      if (query.q) {
        params.push(`%${query.q}%`)
        const searchPlaceholder = `$${params.length}`
        whereClauses.push(`(o.order_number ILIKE ${searchPlaceholder} OR c.name ILIKE ${searchPlaceholder})`)
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`
      const totalResult = await pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM orders o
         JOIN customers c
           ON c.id = o.customer_id
          AND c.organization_id = o.organization_id
         ${whereSql}`,
        params,
      )

      const total = Number(totalResult.rows[0]?.total ?? 0)
      const offset = (page - 1) * pageSize
      const listParams = [...params, pageSize, offset]
      const limitPlaceholder = `$${listParams.length - 1}`
      const offsetPlaceholder = `$${listParams.length}`

      const ordersResult = await pool.query(
        `SELECT
           o.id,
           o.order_number AS "orderNumber",
           o.customer_id AS "customerId",
           c.name AS "customerName",
           o.status,
           o.order_date AS "orderDate",
           o.requested_delivery_date AS "requestedDeliveryDate",
           o.subtotal::text AS subtotal,
           o.total::text AS total,
           COUNT(oi.id)::int AS "itemCount",
           o.warehouse_id AS "warehouseId",
           w.name AS "warehouseName",
           o.delivered_at AS "deliveredAt",
           o.created_at AS "createdAt",
           o.updated_at AS "updatedAt"
         FROM orders o
         JOIN customers c
           ON c.id = o.customer_id
          AND c.organization_id = o.organization_id
         LEFT JOIN warehouses w
           ON w.id = o.warehouse_id
          AND w.organization_id = o.organization_id
         LEFT JOIN order_items oi
           ON oi.order_id = o.id
          AND oi.organization_id = o.organization_id
         ${whereSql}
         GROUP BY o.id, c.name, w.name
         ORDER BY o.created_at DESC
         LIMIT ${limitPlaceholder}
         OFFSET ${offsetPlaceholder}`,
        listParams,
      )

      return {
        orders: ordersResult.rows,
        pagination: {
          total,
          page,
          pageSize,
          totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        },
      }
    },
  )

  app.get(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request, reply) => {
      const { id } = orderIdParamsSchema.parse(request.params)
      const organizationId = request.organizationAccess!.organization.id
      const order = await getOrderById(pool, organizationId, id)

      if (!order) {
        return reply.code(404).send({ message: 'Pedido no encontrado.' })
      }

      return { order, transitions: allowedTransitions[order.status as OrderStatus] }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createOrderSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const userId = request.organizationAccess!.user.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const customerCheck = await ensureActiveCustomer(client, organizationId, input.customerId)
        if (!customerCheck.ok) {
          await rollbackTransaction(client)
          return reply.code(customerCheck.statusCode).send({ message: customerCheck.message })
        }

        const prepared = await prepareOrderItems(client, organizationId, input.items)
        if (!prepared.ok) {
          await rollbackTransaction(client)
          return reply.code(prepared.statusCode).send({ message: prepared.message })
        }

        const orderNumber = await getNextOrderNumber(client, organizationId)
        const orderResult = await client.query<{ id: string }>(
          `INSERT INTO orders (
             organization_id,
             order_number,
             customer_id,
             order_date,
             requested_delivery_date,
             notes,
             subtotal,
             total,
             created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            organizationId,
            orderNumber,
            input.customerId,
            toIsoDate(input.orderDate),
            nullableIsoDate(input.requestedDeliveryDate),
            normalizeOptionalText(input.notes),
            prepared.subtotal,
            prepared.total,
            userId,
          ],
        )

        const orderId = orderResult.rows[0].id
        const itemsResult = await replaceOrderItems(client, organizationId, orderId, input.items)
        if (!itemsResult.ok) {
          await rollbackTransaction(client)
          return reply.code(itemsResult.statusCode).send({ message: itemsResult.message })
        }

        await client.query(
          `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by)
           VALUES ($1, NULL, 'new', $2)`,
          [orderId, userId],
        )

        await client.query('COMMIT')

        const order = await getOrderById(pool, organizationId, orderId)
        return reply.code(201).send({ order, transitions: allowedTransitions.new })
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )

  app.patch(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = orderIdParamsSchema.parse(request.params)
      const input = updateOrderSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const currentResult = await client.query<{ status: OrderStatus; warehouseId: string | null }>(
          `SELECT status, warehouse_id AS "warehouseId"
           FROM orders
           WHERE organization_id = $1
             AND id = $2
           FOR UPDATE`,
          [organizationId, id],
        )
        const currentOrder = currentResult.rows[0]

        if (!currentOrder) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Pedido no encontrado.' })
        }

        if (!editableStatuses.includes(currentOrder.status)) {
          await rollbackTransaction(client)
          return reply.code(400).send({ message: 'Solo se pueden editar pedidos nuevos o confirmados.' })
        }

        if (input.customerId) {
          const customerCheck = await ensureActiveCustomer(client, organizationId, input.customerId)
          if (!customerCheck.ok) {
            await rollbackTransaction(client)
            return reply.code(customerCheck.statusCode).send({ message: customerCheck.message })
          }
        }

        let nextSubtotal: number | null = null
        let nextTotal: number | null = null
        if (input.items) {
          // Un pedido confirmado tiene stock reservado: se libera la reserva de los items
          // actuales y se reserva la de los nuevos en la misma transaccion (todo o nada).
          const reservedWarehouseId = reservedStatuses.includes(currentOrder.status)
            ? currentOrder.warehouseId
            : null
          const previousRequirements = reservedWarehouseId
            ? await getOrderStockRequirements(client, organizationId, id)
            : []

          const itemsResult = await replaceOrderItems(client, organizationId, id, input.items)
          if (!itemsResult.ok) {
            await rollbackTransaction(client)
            return reply.code(itemsResult.statusCode).send({ message: itemsResult.message })
          }

          if (reservedWarehouseId) {
            const nextRequirements = aggregateByProduct(itemsResult.preparedItems)
            const productIds = [
              ...new Set([...previousRequirements, ...nextRequirements].map((item) => item.productId)),
            ]
            const balances = await lockBalances(client, organizationId, reservedWarehouseId, productIds)
            await releaseStock(client, organizationId, reservedWarehouseId, previousRequirements, balances)

            const reservation = await reserveStock(
              client,
              organizationId,
              reservedWarehouseId,
              nextRequirements,
              balances,
            )
            if (!reservation.ok) {
              await rollbackTransaction(client)
              const warehouseName = await getWarehouseName(pool, organizationId, reservedWarehouseId)
              return reply
                .code(409)
                .send(insufficientStockBody(reservedWarehouseId, warehouseName, reservation.shortages))
            }
          }

          nextSubtotal = itemsResult.subtotal
          nextTotal = itemsResult.total
        }

        const assignments: string[] = ['updated_at = NOW()']
        const params: Array<string | number | null> = [organizationId, id]

        if (input.customerId !== undefined) {
          params.push(input.customerId)
          assignments.push(`customer_id = $${params.length}`)
        }
        if (input.orderDate !== undefined) {
          params.push(toIsoDate(input.orderDate))
          assignments.push(`order_date = $${params.length}`)
        }
        if (input.requestedDeliveryDate !== undefined) {
          params.push(nullableIsoDate(input.requestedDeliveryDate))
          assignments.push(`requested_delivery_date = $${params.length}`)
        }
        if (input.notes !== undefined) {
          params.push(normalizeOptionalText(input.notes))
          assignments.push(`notes = $${params.length}`)
        }
        if (nextSubtotal !== null && nextTotal !== null) {
          params.push(nextSubtotal)
          assignments.push(`subtotal = $${params.length}`)
          params.push(nextTotal)
          assignments.push(`total = $${params.length}`)
        }

        await client.query(
          `UPDATE orders
           SET ${assignments.join(', ')}
           WHERE organization_id = $1
             AND id = $2`,
          params,
        )

        await client.query('COMMIT')

        const order = await getOrderById(pool, organizationId, id)
        return { order, transitions: allowedTransitions[currentOrder.status] }
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )

  app.patch(
    '/:id/status',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = orderIdParamsSchema.parse(request.params)
      const input = updateOrderStatusSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const userId = request.organizationAccess!.user.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const currentResult = await client.query<{ status: OrderStatus; warehouseId: string | null }>(
          `SELECT status, warehouse_id AS "warehouseId"
           FROM orders
           WHERE organization_id = $1
             AND id = $2
           FOR UPDATE`,
          [organizationId, id],
        )
        const currentOrder = currentResult.rows[0]

        if (!currentOrder) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Pedido no encontrado.' })
        }

        if (!allowedTransitions[currentOrder.status].includes(input.status)) {
          await rollbackTransaction(client)
          return reply.code(400).send({ message: 'Transicion de estado invalida para este pedido.' })
        }

        let warehouseId = currentOrder.warehouseId
        const hasReservation = warehouseId !== null && reservedStatuses.includes(currentOrder.status)

        if (input.status === 'cancelled') {
          if (hasReservation) {
            const requirements = await getOrderStockRequirements(client, organizationId, id)
            const balances = await lockBalances(
              client,
              organizationId,
              warehouseId!,
              requirements.map((item) => item.productId),
            )
            await releaseStock(client, organizationId, warehouseId!, requirements, balances)
          }
        } else {
          const requirements = await getOrderStockRequirements(client, organizationId, id)
          let balances: Awaited<ReturnType<typeof lockBalances>> | null = null

          if (!hasReservation) {
            // Confirmacion (o pedido previo a 6.1 sin deposito): se elige deposito y se reserva.
            if (!input.warehouseId) {
              await rollbackTransaction(client)
              return reply.code(400).send({
                message: 'Selecciona el deposito desde el que se va a despachar el pedido.',
                code: 'warehouse_required',
              })
            }

            const warehouseCheck = await findWarehouseForOrder(client, organizationId, input.warehouseId)
            if (!warehouseCheck.ok) {
              await rollbackTransaction(client)
              return reply.code(warehouseCheck.statusCode).send({ message: warehouseCheck.message })
            }

            balances = await lockBalances(
              client,
              organizationId,
              input.warehouseId,
              requirements.map((item) => item.productId),
            )
            const reservation = await reserveStock(client, organizationId, input.warehouseId, requirements, balances)
            if (!reservation.ok) {
              await rollbackTransaction(client)
              return reply
                .code(409)
                .send(insufficientStockBody(input.warehouseId, warehouseCheck.warehouse.name, reservation.shortages))
            }

            warehouseId = input.warehouseId
          } else if (input.warehouseId && input.warehouseId !== warehouseId) {
            await rollbackTransaction(client)
            return reply.code(400).send({
              message: 'El pedido ya tiene stock reservado en otro deposito. Cancelalo para cambiar de deposito.',
            })
          }

          if (input.status === 'delivered') {
            balances ??= await lockBalances(
              client,
              organizationId,
              warehouseId!,
              requirements.map((item) => item.productId),
            )
            const consumption = await consumeReservedStock(client, {
              organizationId,
              warehouseId: warehouseId!,
              orderId: id,
              userId,
              requirements,
              balances,
            })
            if (!consumption.ok) {
              await rollbackTransaction(client)
              return reply.code(409).send({
                message: 'La reserva de stock del pedido no coincide con el inventario. Revisa el stock del deposito.',
                code: 'reservation_mismatch',
              })
            }
          }
        }

        await client.query(
          `UPDATE orders
           SET status = $3,
               warehouse_id = $4,
               delivered_at = CASE WHEN $3::order_status = 'delivered' THEN NOW() ELSE delivered_at END,
               updated_at = NOW()
           WHERE organization_id = $1
             AND id = $2`,
          [organizationId, id, input.status, warehouseId],
        )

        await client.query(
          `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by)
           VALUES ($1, $2, $3, $4)`,
          [id, currentOrder.status, input.status, userId],
        )

        await client.query('COMMIT')

        const order = await getOrderById(pool, organizationId, id)
        return { order, transitions: allowedTransitions[input.status] }
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )
}
