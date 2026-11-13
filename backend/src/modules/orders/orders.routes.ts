import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { abortTransaction, withTransaction } from '../../db/transaction.js'
import { requireOrganizationRole } from '../../security/authorization.js'
import {
  aggregateByProduct,
  consumeReservedStock,
  lockBalances,
  releaseStock,
  reserveStock,
} from '../inventory/stock-ledger.js'
import {
  allowedTransitions,
  editableStatuses,
  ensureActiveCustomer,
  findWarehouseForOrder,
  getNextOrderNumber,
  getOrderById,
  getOrderStockRequirements,
  getWarehouseName,
  insufficientStockBody,
  normalizeOptionalText,
  nullableIsoDate,
  orderItemSchema,
  orderStatuses,
  prepareOrderItems,
  replaceOrderItems,
  reservedStatuses,
  toIsoDate,
  type OrderStatus,
} from './orders.service.js'
const orderIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const listOrdersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum([...orderStatuses, 'all']).default('all'),
  channel: z.enum(['admin', 'storefront', 'all']).default('all'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
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
      if (query.channel !== 'all') {
        params.push(query.channel)
        whereClauses.push(`o.channel = $${params.length}`)
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
           o.delivery_fee::text AS "deliveryFee",
           o.total::text AS total,
           COUNT(oi.id)::int AS "itemCount",
           o.channel,
           o.fulfillment_type AS "fulfillmentType",
           o.payment_method AS "paymentMethod",
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

      const order = await withTransaction(async (client) => {
        const customerCheck = await ensureActiveCustomer(client, organizationId, input.customerId)
        if (!customerCheck.ok) {
          abortTransaction(customerCheck.statusCode, { message: customerCheck.message })
        }

        const prepared = await prepareOrderItems(client, organizationId, input.items)
        if (!prepared.ok) {
          abortTransaction(prepared.statusCode, { message: prepared.message })
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
          abortTransaction(itemsResult.statusCode, { message: itemsResult.message })
        }

        await client.query(
          `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by)
           VALUES ($1, NULL, 'new', $2)`,
          [orderId, userId],
        )

        return getOrderById(client, organizationId, orderId)
      })

      return reply.code(201).send({ order, transitions: allowedTransitions.new })
    },
  )

  app.patch(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request) => {
      const { id } = orderIdParamsSchema.parse(request.params)
      const input = updateOrderSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      return withTransaction(async (client) => {
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
          abortTransaction(404, { message: 'Pedido no encontrado.' })
        }

        if (!editableStatuses.includes(currentOrder.status)) {
          abortTransaction(400, { message: 'Solo se pueden editar pedidos nuevos o confirmados.' })
        }

        if (input.customerId) {
          const customerCheck = await ensureActiveCustomer(client, organizationId, input.customerId)
          if (!customerCheck.ok) {
            abortTransaction(customerCheck.statusCode, { message: customerCheck.message })
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
            abortTransaction(itemsResult.statusCode, { message: itemsResult.message })
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
              const warehouseName = await getWarehouseName(client, organizationId, reservedWarehouseId)
              abortTransaction(409, insufficientStockBody(reservedWarehouseId, warehouseName, reservation.shortages))
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
          // Pedidos de la tienda: el costo de envio se mantiene al editar los items.
          params.push(nextTotal)
          assignments.push(`total = $${params.length}::numeric + delivery_fee`)
        }

        await client.query(
          `UPDATE orders
           SET ${assignments.join(', ')}
           WHERE organization_id = $1
             AND id = $2`,
          params,
        )

        const order = await getOrderById(client, organizationId, id)
        return { order, transitions: allowedTransitions[currentOrder.status] }
      })
    },
  )

  app.patch(
    '/:id/status',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request) => {
      const { id } = orderIdParamsSchema.parse(request.params)
      const input = updateOrderStatusSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const userId = request.organizationAccess!.user.id

      return withTransaction(async (client) => {
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
          abortTransaction(404, { message: 'Pedido no encontrado.' })
        }

        if (!allowedTransitions[currentOrder.status].includes(input.status)) {
          abortTransaction(400, { message: 'Transicion de estado invalida para este pedido.' })
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
              abortTransaction(400, {
                message: 'Selecciona el deposito desde el que se va a despachar el pedido.',
                code: 'warehouse_required',
              })
            }

            const warehouseCheck = await findWarehouseForOrder(client, organizationId, input.warehouseId)
            if (!warehouseCheck.ok) {
              abortTransaction(warehouseCheck.statusCode, { message: warehouseCheck.message })
            }

            balances = await lockBalances(
              client,
              organizationId,
              input.warehouseId,
              requirements.map((item) => item.productId),
            )
            const reservation = await reserveStock(client, organizationId, input.warehouseId, requirements, balances)
            if (!reservation.ok) {
              abortTransaction(
                409,
                insufficientStockBody(input.warehouseId, warehouseCheck.warehouse.name, reservation.shortages),
              )
            }

            warehouseId = input.warehouseId
          } else if (input.warehouseId && input.warehouseId !== warehouseId) {
            abortTransaction(400, {
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
              abortTransaction(409, {
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

        const order = await getOrderById(client, organizationId, id)
        return { order, transitions: allowedTransitions[input.status] }
      })
    },
  )
}
