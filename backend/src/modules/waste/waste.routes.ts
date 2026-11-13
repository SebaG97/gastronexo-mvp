import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { abortTransaction, withTransaction, type DbClient } from '../../db/transaction.js'
import { requireOrganizationRole } from '../../security/authorization.js'
import { ensureBalances, lockBalances, lockProductCosts, recordMovement } from '../inventory/stock-ledger.js'
import { wholeUnits } from '../orders/orders.service.js'

// Mision 8.3: mermas. Una merma saca stock DISPONIBLE (lo reservado por pedidos no se toca),
// congela el costo del producto y no cambia el costo promedio. Anular devuelve el stock con un
// movimiento inverso (`waste_void`) y recalcula el promedio al costo congelado.

export const wasteReasons = ['expired', 'damaged', 'preparation', 'missing', 'other'] as const

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD.')

const listQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  reason: z.enum(wasteReasons).optional(),
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  status: z.enum(['completed', 'voided', 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const createSchema = z
  .object({
    productId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    quantity: z.coerce.number().positive().max(1_000_000),
    reason: z.enum(wasteReasons),
    notes: z.string().trim().max(500).nullable().optional(),
    occurredOn: isoDate.optional(),
  })
  .refine((input) => input.reason !== 'other' || (input.notes?.trim().length ?? 0) > 0, {
    path: ['notes'],
    message: 'Contá qué pasó cuando el motivo es "Otro".',
  })

const voidSchema = z.object({ reason: z.string().trim().min(3).max(300) })
const idParamsSchema = z.object({ id: z.string().uuid() })

const roundQuantity = (value: number) => Number(value.toFixed(3))
const roundMoney = (value: number) => Number(value.toFixed(2))

function todayIso() {
  // Fecha local del servidor (la operacion es en una sola zona horaria).
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

async function getNextWasteNumber(client: DbClient, organizationId: string) {
  const result = await client.query<{ nextNumber: number }>(
    `INSERT INTO waste_sequences (organization_id, last_number)
     VALUES ($1, 1)
     ON CONFLICT (organization_id)
     DO UPDATE SET last_number = waste_sequences.last_number + 1
     RETURNING last_number AS "nextNumber"`,
    [organizationId],
  )
  return `MER-${String(result.rows[0].nextNumber).padStart(6, '0')}`
}

async function getGlobalQuantity(client: DbClient, organizationId: string, productId: string) {
  const result = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::text AS total
     FROM inventory_balances
     WHERE organization_id = $1 AND product_id = $2`,
    [organizationId, productId],
  )
  return Number(result.rows[0]?.total ?? 0)
}

const recordColumns = `
  wr.id,
  wr.waste_number AS "wasteNumber",
  wr.product_id AS "productId",
  wr.product_name_snapshot AS "productName",
  wr.product_unit_snapshot AS "productUnit",
  wr.warehouse_id AS "warehouseId",
  w.name AS "warehouseName",
  wr.quantity::text AS quantity,
  wr.reason,
  wr.notes,
  wr.occurred_on::text AS "occurredOn",
  wr.unit_cost::text AS "unitCost",
  wr.total_cost::text AS "totalCost",
  wr.status,
  wr.created_by AS "createdBy",
  cu.full_name AS "createdByUserName",
  wr.created_at AS "createdAt",
  wr.voided_at AS "voidedAt",
  vu.full_name AS "voidedByUserName",
  wr.void_reason AS "voidReason"`

const recordJoins = `
  FROM waste_records wr
  JOIN warehouses w ON w.id = wr.warehouse_id AND w.organization_id = wr.organization_id
  JOIN users cu ON cu.id = wr.created_by
  LEFT JOIN users vu ON vu.id = wr.voided_by`

async function getWasteRecord(client: DbClient, organizationId: string, id: string) {
  const result = await client.query(
    `SELECT ${recordColumns} ${recordJoins} WHERE wr.organization_id = $1 AND wr.id = $2`,
    [organizationId, id],
  )
  return result.rows[0] ?? null
}

export const wasteRoutes: FastifyPluginAsync = async (app) => {
  const readRoles = requireOrganizationRole('owner', 'admin', 'operator', 'viewer')
  const writeRoles = requireOrganizationRole('owner', 'admin', 'operator')

  app.get('/', { preHandler: readRoles }, async (request) => {
    const query = listQuerySchema.parse(request.query)
    const organizationId = request.organizationAccess!.organization.id

    const where = ['wr.organization_id = $1']
    const params: Array<string | number> = [organizationId]
    const add = (clause: (placeholder: string) => string, value: string | number) => {
      params.push(value)
      where.push(clause(`$${params.length}`))
    }
    if (query.from) add((p) => `wr.occurred_on >= ${p}::date`, query.from)
    if (query.to) add((p) => `wr.occurred_on <= ${p}::date`, query.to)
    if (query.reason) add((p) => `wr.reason = ${p}`, query.reason)
    if (query.productId) add((p) => `wr.product_id = ${p}`, query.productId)
    if (query.warehouseId) add((p) => `wr.warehouse_id = ${p}`, query.warehouseId)
    // El resumen siempre cuenta solo las mermas vigentes (las anuladas no son perdida).
    const summaryWhere = [...where, `wr.status = 'completed'`].join(' AND ')
    const summaryParams = [...params]
    if (query.status !== 'all') add((p) => `wr.status = ${p}`, query.status)
    const whereSql = where.join(' AND ')

    const [totalResult, summaryResult] = await Promise.all([
      pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM waste_records wr WHERE ${whereSql}`, params),
      pool.query<{ reason: string; count: number; totalCost: string }>(
        `SELECT wr.reason, COUNT(*)::int AS count, COALESCE(SUM(wr.total_cost), 0)::text AS "totalCost"
         FROM waste_records wr
         WHERE ${summaryWhere}
         GROUP BY wr.reason
         ORDER BY SUM(wr.total_cost) DESC`,
        summaryParams,
      ),
    ])
    const total = totalResult.rows[0]?.total ?? 0
    const offset = (query.page - 1) * query.pageSize
    const rows = await pool.query(
      `SELECT ${recordColumns} ${recordJoins}
       WHERE ${whereSql}
       ORDER BY wr.occurred_on DESC, wr.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, offset],
    )

    const byReason = summaryResult.rows.map((row) => ({ reason: row.reason, count: row.count, totalCost: row.totalCost }))
    return {
      wasteRecords: rows.rows,
      summary: {
        count: byReason.reduce((sum, row) => sum + row.count, 0),
        totalCost: roundMoney(byReason.reduce((sum, row) => sum + Number(row.totalCost), 0)).toFixed(2),
        byReason,
      },
      pagination: { total, page: query.page, pageSize: query.pageSize, totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize) },
    }
  })

  app.get('/:id', { preHandler: readRoles }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params)
    const record = await getWasteRecord(pool, request.organizationAccess!.organization.id, id)
    if (!record) return reply.code(404).send({ message: 'Merma no encontrada.' })
    return { wasteRecord: record }
  })

  app.post('/', { preHandler: writeRoles }, async (request, reply) => {
    const input = createSchema.parse(request.body)
    const organizationId = request.organizationAccess!.organization.id
    const userId = request.organizationAccess!.user.id
    const occurredOn = input.occurredOn ?? todayIso()
    if (occurredOn > todayIso()) {
      return reply.code(400).send({ message: 'La fecha de la merma no puede ser futura.', code: 'future_date' })
    }

    const wasteRecord = await withTransaction(async (client) => {
      const productResult = await client.query<{ id: string; name: string; unit: string; isActive: boolean }>(
        `SELECT id, name, unit, is_active AS "isActive" FROM products WHERE organization_id = $1 AND id = $2`,
        [organizationId, input.productId],
      )
      const product = productResult.rows[0]
      if (!product) abortTransaction(404, { message: 'Producto no encontrado.' })
      if (wholeUnits.has(product.unit) && !Number.isInteger(input.quantity)) {
        abortTransaction(400, { message: `${product.name} se cuenta por unidades: usá una cantidad entera.`, code: 'invalid_quantity' })
      }

      const warehouseResult = await client.query<{ id: string; isActive: boolean }>(
        `SELECT id, is_active AS "isActive" FROM warehouses WHERE organization_id = $1 AND id = $2`,
        [organizationId, input.warehouseId],
      )
      const warehouse = warehouseResult.rows[0]
      if (!warehouse) abortTransaction(404, { message: 'Depósito no encontrado.' })
      if (!warehouse.isActive) abortTransaction(409, { message: 'El depósito está inactivo.', code: 'warehouse_inactive' })

      // Orden canonico (6.3): balances -> costos de products -> secuencia.
      const balances = await lockBalances(client, organizationId, input.warehouseId, [product.id])
      const balance = balances.get(product.id)
      const available = balance ? roundQuantity(balance.quantity - balance.reservedQuantity) : 0
      const quantity = roundQuantity(input.quantity)
      if (!balance || available < quantity) {
        abortTransaction(409, {
          message: `De ${product.name} hay ${available.toFixed(3)} disponibles en este depósito (lo reservado por pedidos no se puede dar de baja).`,
          code: 'insufficient_stock',
          available: available.toFixed(3),
          reserved: (balance?.reservedQuantity ?? 0).toFixed(3),
        })
      }

      const costs = await lockProductCosts(client, organizationId, [product.id])
      const unitCost = costs.get(product.id) ?? 0
      const wasteNumber = await getNextWasteNumber(client, organizationId)
      const id = randomUUID()

      await client.query(
        `INSERT INTO waste_records (
           id, organization_id, waste_number, product_id, warehouse_id, quantity, reason, notes,
           occurred_on, unit_cost, total_cost, product_name_snapshot, product_unit_snapshot, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          id,
          organizationId,
          wasteNumber,
          product.id,
          input.warehouseId,
          quantity,
          input.reason,
          input.notes?.trim() || null,
          occurredOn,
          unitCost,
          roundMoney(unitCost * quantity),
          product.name,
          product.unit,
          userId,
        ],
      )

      const balanceAfter = roundQuantity(balance.quantity - quantity)
      await client.query(
        `UPDATE inventory_balances SET quantity = $4, updated_at = NOW()
         WHERE organization_id = $1 AND warehouse_id = $2 AND product_id = $3`,
        [organizationId, input.warehouseId, product.id, balanceAfter],
      )
      await recordMovement(client, {
        organizationId,
        warehouseId: input.warehouseId,
        productId: product.id,
        movementType: 'waste',
        quantityDelta: -quantity,
        balanceAfter,
        sourceType: 'waste',
        sourceId: id,
        createdBy: userId,
      })

      return getWasteRecord(client, organizationId, id)
    })

    return reply.code(201).send({ wasteRecord })
  })

  app.post('/:id/void', { preHandler: writeRoles }, async (request) => {
    const { id } = idParamsSchema.parse(request.params)
    const input = voidSchema.parse(request.body ?? {})
    const organizationId = request.organizationAccess!.organization.id
    const userId = request.organizationAccess!.user.id

    return withTransaction(async (client) => {
      // Cabecera primero (FOR UPDATE): dos anulaciones simultaneas se serializan aca.
      const recordResult = await client.query<{
        productId: string
        warehouseId: string
        quantity: string
        totalCost: string
        status: 'completed' | 'voided'
        wasteNumber: string
      }>(
        `SELECT product_id AS "productId", warehouse_id AS "warehouseId", quantity::text AS quantity,
                total_cost::text AS "totalCost", status, waste_number AS "wasteNumber"
         FROM waste_records
         WHERE organization_id = $1 AND id = $2
         FOR UPDATE`,
        [organizationId, id],
      )
      const record = recordResult.rows[0]
      if (!record) abortTransaction(404, { message: 'Merma no encontrada.' })
      if (record.status === 'voided') {
        abortTransaction(409, { message: `${record.wasteNumber} ya está anulada.`, code: 'already_voided' })
      }

      const quantity = Number(record.quantity)
      await ensureBalances(client, organizationId, record.warehouseId, [record.productId])
      const balances = await lockBalances(client, organizationId, record.warehouseId, [record.productId])
      const costs = await lockProductCosts(client, organizationId, [record.productId])
      const balance = balances.get(record.productId)!
      const balanceAfter = roundQuantity(balance.quantity + quantity)

      await client.query(
        `UPDATE inventory_balances SET quantity = $4, updated_at = NOW()
         WHERE organization_id = $1 AND warehouse_id = $2 AND product_id = $3`,
        [organizationId, record.warehouseId, record.productId, balanceAfter],
      )
      await recordMovement(client, {
        organizationId,
        warehouseId: record.warehouseId,
        productId: record.productId,
        movementType: 'waste',
        quantityDelta: quantity,
        balanceAfter,
        sourceType: 'waste_void',
        sourceId: id,
        createdBy: userId,
      })

      // El stock vuelve al costo con el que salio: promedio ponderado, como una compra a ese costo.
      const globalAfter = await getGlobalQuantity(client, organizationId, record.productId)
      const globalBefore = roundQuantity(globalAfter - quantity)
      const previousCost = costs.get(record.productId) ?? 0
      const newCost = globalAfter > 0 ? roundMoney((globalBefore * previousCost + Number(record.totalCost)) / globalAfter) : previousCost
      await client.query('UPDATE products SET cost = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2', [
        organizationId,
        record.productId,
        newCost,
      ])

      await client.query(
        `UPDATE waste_records
         SET status = 'voided', voided_by = $3, voided_at = NOW(), void_reason = $4, updated_at = NOW()
         WHERE organization_id = $1 AND id = $2`,
        [organizationId, id, userId, input.reason],
      )

      return { wasteRecord: await getWasteRecord(client, organizationId, id) }
    })
  })
}
