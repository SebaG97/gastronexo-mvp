import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

const purchaseIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const listPurchasesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const createPurchaseSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1).max(120),
  purchaseDate: z.coerce.date(),
  paymentMethod: z.string().trim().min(1).max(60),
  notes: z.string().trim().max(600).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unitCost: z.coerce.number().positive(),
      }),
    )
    .min(1)
    .max(300),
})

type PurchaseItemInput = z.infer<typeof createPurchaseSchema>['items'][number]

type PurchaseSummaryRow = {
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

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function normalizeOptionalText(value: string | undefined) {
  if (value === undefined) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

async function rollbackTransaction(client: Pick<typeof pool, 'query'>) {
  try {
    await client.query('ROLLBACK')
  } catch {
    return
  }
}

async function getPurchaseById(
  client: Pick<typeof pool, 'query'>,
  organizationId: string,
  purchaseId: string,
) {
  const purchaseResult = await client.query<PurchaseSummaryRow>(
    `SELECT
       po.id,
       po.supplier_id AS "supplierId",
       s.name AS "supplierName",
       po.warehouse_id AS "warehouseId",
       w.name AS "warehouseName",
       po.invoice_number AS "invoiceNumber",
       po.purchase_date AS "purchaseDate",
       po.payment_method AS "paymentMethod",
       po.notes,
       po.total_amount::text AS "totalAmount",
       po.created_by_user_id AS "createdByUserId",
       u.full_name AS "createdByUserName",
       po.created_at AS "createdAt",
       po.updated_at AS "updatedAt"
     FROM purchase_orders po
     JOIN suppliers s
       ON s.id = po.supplier_id
      AND s.organization_id = po.organization_id
     JOIN warehouses w
       ON w.id = po.warehouse_id
      AND w.organization_id = po.organization_id
     JOIN users u ON u.id = po.created_by_user_id
     WHERE po.organization_id = $1
       AND po.id = $2
     LIMIT 1`,
    [organizationId, purchaseId],
  )

  const purchase = purchaseResult.rows[0]
  if (!purchase) {
    return null
  }

  const itemsResult = await client.query(
    `SELECT
       poi.id,
       poi.product_id AS "productId",
       p.name AS "productName",
       p.unit,
       poi.quantity::text AS quantity,
       poi.unit_cost::text AS "unitCost",
       poi.line_total::text AS "lineTotal"
     FROM purchase_order_items poi
     JOIN purchase_orders po ON po.id = poi.purchase_order_id
     JOIN products p
       ON p.id = poi.product_id
      AND p.organization_id = po.organization_id
     WHERE po.organization_id = $1
       AND poi.purchase_order_id = $2
     ORDER BY p.name ASC`,
    [organizationId, purchaseId],
  )

  return {
    ...purchase,
    items: itemsResult.rows,
  }
}

export const purchasesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request, reply) => {
      const query = listPurchasesQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id
      const page = query.page
      const pageSize = query.pageSize

      const whereClauses = ['po.organization_id = $1']
      const params: Array<string | number | Date> = [organizationId]

      if (query.supplierId) {
        const supplierResult = await pool.query<{ id: string }>(
          `SELECT id
           FROM suppliers
           WHERE organization_id = $1
             AND id = $2
           LIMIT 1`,
          [organizationId, query.supplierId],
        )

        if (!supplierResult.rows[0]) {
          return reply.code(404).send({ message: 'Proveedor no encontrado.' })
        }

        params.push(query.supplierId)
        whereClauses.push(`po.supplier_id = $${params.length}`)
      }

      if (query.warehouseId) {
        const warehouseResult = await pool.query<{ id: string }>(
          `SELECT id
           FROM warehouses
           WHERE organization_id = $1
             AND id = $2
           LIMIT 1`,
          [organizationId, query.warehouseId],
        )

        if (!warehouseResult.rows[0]) {
          return reply.code(404).send({ message: 'Depósito no encontrado.' })
        }

        params.push(query.warehouseId)
        whereClauses.push(`po.warehouse_id = $${params.length}`)
      }

      if (query.from) {
        params.push(query.from)
        whereClauses.push(`po.purchase_date >= $${params.length}`)
      }

      if (query.to) {
        params.push(query.to)
        whereClauses.push(`po.purchase_date <= $${params.length}`)
      }

      if (query.q) {
        params.push(`%${query.q}%`)
        const searchPlaceholder = `$${params.length}`
        whereClauses.push(
          `(po.invoice_number ILIKE ${searchPlaceholder} OR s.name ILIKE ${searchPlaceholder})`,
        )
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`

      const totalResult = await pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         ${whereSql}`,
        params,
      )

      const total = Number(totalResult.rows[0]?.total ?? 0)
      const offset = (page - 1) * pageSize
      const listParams = [...params, pageSize, offset]
      const limitPlaceholder = `$${listParams.length - 1}`
      const offsetPlaceholder = `$${listParams.length}`

      const purchasesResult = await pool.query(
        `SELECT
           po.id,
           po.supplier_id AS "supplierId",
           s.name AS "supplierName",
           po.warehouse_id AS "warehouseId",
           w.name AS "warehouseName",
           po.invoice_number AS "invoiceNumber",
           po.purchase_date AS "purchaseDate",
           po.payment_method AS "paymentMethod",
           po.notes,
           po.total_amount::text AS "totalAmount",
           po.created_by_user_id AS "createdByUserId",
           u.full_name AS "createdByUserName",
           po.created_at AS "createdAt",
           po.updated_at AS "updatedAt"
         FROM purchase_orders po
         JOIN suppliers s
           ON s.id = po.supplier_id
          AND s.organization_id = po.organization_id
         JOIN warehouses w
           ON w.id = po.warehouse_id
          AND w.organization_id = po.organization_id
         JOIN users u ON u.id = po.created_by_user_id
         ${whereSql}
         ORDER BY po.purchase_date DESC, po.created_at DESC
         LIMIT ${limitPlaceholder}
         OFFSET ${offsetPlaceholder}`,
        listParams,
      )

      return {
        purchases: purchasesResult.rows,
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
      const { id } = purchaseIdParamsSchema.parse(request.params)
      const organizationId = request.organizationAccess!.organization.id

      const purchase = await getPurchaseById(pool, organizationId, id)
      if (!purchase) {
        return reply.code(404).send({ message: 'Compra no encontrada.' })
      }

      return { purchase }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createPurchaseSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const userId = request.organizationAccess!.user.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const supplierResult = await client.query<{ id: string; isActive: boolean }>(
          `SELECT id, is_active AS "isActive"
           FROM suppliers
           WHERE organization_id = $1
             AND id = $2
           LIMIT 1`,
          [organizationId, input.supplierId],
        )

        if (!supplierResult.rows[0]) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Proveedor no encontrado.' })
        }

        if (!supplierResult.rows[0].isActive) {
          await rollbackTransaction(client)
          return reply.code(400).send({ message: 'No se puede registrar una compra con un proveedor inactivo.' })
        }

        const warehouseResult = await client.query<{ id: string; isActive: boolean }>(
          `SELECT id, is_active AS "isActive"
           FROM warehouses
           WHERE organization_id = $1
             AND id = $2
           LIMIT 1`,
          [organizationId, input.warehouseId],
        )

        if (!warehouseResult.rows[0]) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Depósito no encontrado.' })
        }

        if (!warehouseResult.rows[0].isActive) {
          await rollbackTransaction(client)
          return reply.code(400).send({ message: 'No se puede registrar una compra en un depÃ³sito inactivo.' })
        }

        const productIds = [...new Set(input.items.map((item) => item.productId))]
        const productsResult = await client.query<{
          id: string
          name: string
          isActive: boolean
          productType: 'raw_material' | 'finished_product'
        }>(
          `SELECT
             id,
             name,
             is_active AS "isActive",
             product_type AS "productType"
           FROM products
           WHERE organization_id = $1
             AND id = ANY($2::uuid[])`,
          [organizationId, productIds],
        )

        if (productsResult.rows.length !== productIds.length) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Producto no encontrado.' })
        }

        const productsById = new Map(productsResult.rows.map((product) => [product.id, product]))
        for (const item of input.items) {
          const product = productsById.get(item.productId)
          if (!product || !product.isActive || product.productType !== 'raw_material') {
            await rollbackTransaction(client)
            return reply.code(400).send({
              message: 'Solo se permite comprar materias primas activas.',
            })
          }
        }

        const itemsWithTotals = input.items.map((item) => {
          const lineTotal = Number((item.quantity * item.unitCost).toFixed(2))

          return {
            ...item,
            lineTotal,
          }
        })

        const totalAmount = Number(
          itemsWithTotals.reduce((accumulator, item) => accumulator + item.lineTotal, 0).toFixed(2),
        )

        const purchaseResult = await client.query<{ id: string }>(
          `INSERT INTO purchase_orders (
             organization_id,
             supplier_id,
             warehouse_id,
             invoice_number,
             purchase_date,
             payment_method,
             notes,
             total_amount,
             created_by_user_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            organizationId,
            input.supplierId,
            input.warehouseId,
            input.invoiceNumber,
            toIsoDate(input.purchaseDate),
            input.paymentMethod,
            normalizeOptionalText(input.notes),
            totalAmount,
            userId,
          ],
        )

        const purchaseId = purchaseResult.rows[0].id

        const itemRowsSql = itemsWithTotals
          .map(
            (_item, index) =>
              `($1, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4}, $${index * 4 + 5})`,
          )
          .join(', ')

        const itemParams: Array<string | number> = [purchaseId]
        for (const item of itemsWithTotals) {
          itemParams.push(item.productId, item.quantity, item.unitCost, item.lineTotal)
        }

        await client.query(
          `INSERT INTO purchase_order_items (
             purchase_order_id,
             product_id,
             quantity,
             unit_cost,
             line_total
           )
           VALUES ${itemRowsSql}`,
          itemParams,
        )

        const aggregatedByProduct = new Map<
          string,
          { quantity: number; total: number; weightedUnitCost: number; item: PurchaseItemInput }
        >()

        for (const item of itemsWithTotals) {
          const current = aggregatedByProduct.get(item.productId)
          if (!current) {
            aggregatedByProduct.set(item.productId, {
              quantity: item.quantity,
              total: item.lineTotal,
              weightedUnitCost: 0,
              item,
            })
            continue
          }

          aggregatedByProduct.set(item.productId, {
            ...current,
            quantity: current.quantity + item.quantity,
            total: current.total + item.lineTotal,
          })
        }

        const stockChanges: Array<{
          productId: string
          previousQuantity: string
          newQuantity: string
          delta: string
          resultingCost: string
        }> = []

        for (const [productId, aggregate] of aggregatedByProduct.entries()) {
          const incomingQuantity = Number(aggregate.quantity.toFixed(3))
          const incomingTotal = Number(aggregate.total.toFixed(2))

          const balanceResult = await client.query<{ quantity: string }>(
            `SELECT quantity::text AS quantity
             FROM inventory_balances
             WHERE organization_id = $1
               AND warehouse_id = $2
               AND product_id = $3
             FOR UPDATE`,
            [organizationId, input.warehouseId, productId],
          )

          const previousQuantity = Number(balanceResult.rows[0]?.quantity ?? '0')
          const newQuantity = Number((previousQuantity + incomingQuantity).toFixed(3))

          await client.query(
            `INSERT INTO inventory_balances (organization_id, warehouse_id, product_id, quantity)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (warehouse_id, product_id)
             DO UPDATE SET
               quantity = inventory_balances.quantity + EXCLUDED.quantity,
               updated_at = NOW()`,
            [organizationId, input.warehouseId, productId, incomingQuantity],
          )

          await client.query(
            `INSERT INTO inventory_adjustments (
               organization_id,
               warehouse_id,
               product_id,
               previous_quantity,
               new_quantity,
               delta,
               reason,
               created_by_user_id,
               source_type,
               purchase_order_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'purchase', $9)`,
            [
              organizationId,
              input.warehouseId,
              productId,
              previousQuantity,
              newQuantity,
              incomingQuantity,
              `purchase:${purchaseId}`,
              userId,
              purchaseId,
            ],
          )

          const productCostResult = await client.query<{ cost: string }>(
            `SELECT cost::text AS cost
             FROM products
             WHERE organization_id = $1
               AND id = $2
             FOR UPDATE`,
            [organizationId, productId],
          )

          const previousCost = Number(productCostResult.rows[0]?.cost ?? '0')
          const globalStockResult = await client.query<{ totalQuantity: string }>(
            `SELECT COALESCE(SUM(quantity), 0)::text AS "totalQuantity"
             FROM inventory_balances
             WHERE organization_id = $1
               AND product_id = $2`,
            [organizationId, productId],
          )

          const globalQuantityAfterPurchase = Number(globalStockResult.rows[0]?.totalQuantity ?? '0')
          const globalQuantityBeforePurchase = Number(
            (globalQuantityAfterPurchase - incomingQuantity).toFixed(3),
          )

          const newCost =
            globalQuantityAfterPurchase > 0
              ? Number(
                  (
                    (globalQuantityBeforePurchase * previousCost + incomingTotal) /
                    globalQuantityAfterPurchase
                  ).toFixed(2),
                )
              : previousCost

          await client.query(
            `UPDATE products
             SET cost = $3,
                 updated_at = NOW()
             WHERE organization_id = $1
               AND id = $2`,
            [organizationId, productId, newCost],
          )

          stockChanges.push({
            productId,
            previousQuantity: previousQuantity.toFixed(3),
            newQuantity: newQuantity.toFixed(3),
            delta: incomingQuantity.toFixed(3),
            resultingCost: newCost.toFixed(2),
          })
        }

        await client.query('COMMIT')

        const purchase = await getPurchaseById(pool, organizationId, purchaseId)

        return reply.code(201).send({
          purchase,
          stockChanges,
        })
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )
}
