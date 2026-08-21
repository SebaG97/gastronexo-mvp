import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

const productTypeSchema = z.enum(['raw_material', 'finished_product'])

const listInventoryQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  productType: productTypeSchema.optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const createInventoryAdjustmentSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  newQuantity: z.coerce.number().min(0),
  reason: z.string().trim().min(1).max(300),
})

const listInventoryAdjustmentsQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

async function rollbackTransaction(client: Pick<typeof pool, 'query'>) {
  try {
    await client.query('ROLLBACK')
  } catch {
    return
  }
}

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request, reply) => {
      const query = listInventoryQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id
      const page = query.page
      const pageSize = query.pageSize
      const searchTerm = query.q?.trim()

      const countParams: Array<string | number | boolean> = [organizationId]
      const listParams: Array<string | number | boolean> = [organizationId]
      const filters: string[] = ['p.organization_id = $1', 'p.is_active = true']
      let warehouseForZeroBalances: { id: string; isActive: boolean } | null = null

      if (query.warehouseId) {
        const warehouseResult = await pool.query<{ id: string; isActive: boolean }>(
          `SELECT id, is_active AS "isActive"
           FROM warehouses
           WHERE organization_id = $1
             AND id = $2
           LIMIT 1`,
          [organizationId, query.warehouseId],
        )

        warehouseForZeroBalances = warehouseResult.rows[0] ?? null
        if (!warehouseForZeroBalances) {
          return reply.code(404).send({ message: 'Depósito no encontrado.' })
        }
      }

      if (query.productType) {
        countParams.push(query.productType)
        listParams.push(query.productType)
        const productTypePlaceholder = `$${countParams.length}`
        filters.push(`p.product_type = ${productTypePlaceholder}`)
      }

      if (searchTerm) {
        countParams.push(`%${searchTerm}%`)
        listParams.push(`%${searchTerm}%`)
        const searchPlaceholder = `$${countParams.length}`
        filters.push(`(p.name ILIKE ${searchPlaceholder} OR COALESCE(p.sku, '') ILIKE ${searchPlaceholder})`)
      }

      const whereSql = `WHERE ${filters.join(' AND ')}`

      if (warehouseForZeroBalances?.isActive) {
        countParams.push(warehouseForZeroBalances.id)
        const countWarehousePlaceholder = `$${countParams.length}`

        const totalResult = await pool.query<{ total: number }>(
          `SELECT COUNT(*)::int AS total
           FROM products p
           ${whereSql}`,
          countParams.slice(0, countParams.length - 1),
        )

        const total = Number(totalResult.rows[0]?.total ?? 0)
        const offset = (page - 1) * pageSize

        listParams.push(warehouseForZeroBalances.id)
        const listWarehousePlaceholder = `$${listParams.length}`
        listParams.push(pageSize)
        listParams.push(offset)

        const limitPlaceholder = `$${listParams.length - 1}`
        const offsetPlaceholder = `$${listParams.length}`

        const result = await pool.query(
          `SELECT
             p.id AS "productId",
             p.name AS "productName",
             p.sku,
             p.product_type AS "productType",
             p.unit,
             p.cost,
             p.category_id AS "categoryId",
             c.name AS "categoryName",
             w.id AS "warehouseId",
             w.name AS "warehouseName",
             COALESCE(ib.quantity, 0)::text AS quantity,
             ib.updated_at AS "updatedAt"
           FROM products p
           CROSS JOIN warehouses w
           LEFT JOIN inventory_balances ib
             ON ib.organization_id = p.organization_id
            AND ib.product_id = p.id
            AND ib.warehouse_id = w.id
           LEFT JOIN product_categories c
             ON c.id = p.category_id
            AND c.organization_id = p.organization_id
           ${whereSql}
             AND w.organization_id = p.organization_id
             AND w.id = ${listWarehousePlaceholder}
           ORDER BY p.name ASC
           LIMIT ${limitPlaceholder}
           OFFSET ${offsetPlaceholder}`,
          listParams,
        )

        const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)

        return {
          balances: result.rows,
          pagination: {
            total,
            page,
            pageSize,
            totalPages,
          },
        }
      }

      const whereClauses = ['ib.organization_id = $1']
      const whereParams: Array<string | number | boolean> = [organizationId]

      if (query.warehouseId) {
        whereParams.push(query.warehouseId)
        whereClauses.push(`ib.warehouse_id = $${whereParams.length}`)
      }

      if (query.productType) {
        whereParams.push(query.productType)
        whereClauses.push(`p.product_type = $${whereParams.length}`)
      }

      if (searchTerm) {
        whereParams.push(`%${searchTerm}%`)
        const searchPlaceholder = `$${whereParams.length}`
        whereClauses.push(`(p.name ILIKE ${searchPlaceholder} OR COALESCE(p.sku, '') ILIKE ${searchPlaceholder})`)
      }

      const balanceWhereSql = `WHERE ${whereClauses.join(' AND ')}`

      const totalResult = await pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM inventory_balances ib
         JOIN products p
           ON p.id = ib.product_id
          AND p.organization_id = ib.organization_id
         ${balanceWhereSql}`,
        whereParams,
      )

      const total = Number(totalResult.rows[0]?.total ?? 0)
      const offset = (page - 1) * pageSize

      const params = [...whereParams, pageSize, offset]
      const limitPlaceholder = `$${params.length - 1}`
      const offsetPlaceholder = `$${params.length}`

      const result = await pool.query(
        `SELECT
           p.id AS "productId",
           p.name AS "productName",
           p.sku,
           p.product_type AS "productType",
           p.unit,
           p.cost,
           p.category_id AS "categoryId",
           c.name AS "categoryName",
           w.id AS "warehouseId",
           w.name AS "warehouseName",
           ib.quantity::text AS quantity,
           ib.updated_at AS "updatedAt"
         FROM inventory_balances ib
         JOIN products p
           ON p.id = ib.product_id
          AND p.organization_id = ib.organization_id
         JOIN warehouses w
           ON w.id = ib.warehouse_id
          AND w.organization_id = ib.organization_id
         LEFT JOIN product_categories c
           ON c.id = p.category_id
          AND c.organization_id = p.organization_id
         ${balanceWhereSql}
         ORDER BY p.name ASC
         LIMIT ${limitPlaceholder}
         OFFSET ${offsetPlaceholder}`,
        params,
      )

      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)

      return {
        balances: result.rows,
        pagination: {
          total,
          page,
          pageSize,
          totalPages,
        },
      }
    },
  )

  app.post(
    '/adjustments',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createInventoryAdjustmentSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const userId = request.organizationAccess!.user.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const warehouseResult = await client.query<{ id: string }>(
          `SELECT id
           FROM warehouses
           WHERE organization_id = $1
             AND id = $2
           LIMIT 1`,
          [organizationId, input.warehouseId],
        )

        const productResult = await client.query<{ id: string }>(
          `SELECT id
           FROM products
           WHERE organization_id = $1
             AND id = $2
           LIMIT 1`,
          [organizationId, input.productId],
        )

        if (!warehouseResult.rows[0] || !productResult.rows[0]) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Recurso no encontrado.' })
        }

        const balanceResult = await client.query<{ id: string; quantity: string }>(
          `SELECT id, quantity::text AS quantity
           FROM inventory_balances
           WHERE organization_id = $1
             AND warehouse_id = $2
             AND product_id = $3
           FOR UPDATE`,
          [organizationId, input.warehouseId, input.productId],
        )

        const currentBalance = balanceResult.rows[0]
        const previousQuantity = Number(currentBalance?.quantity ?? '0')
        const delta = input.newQuantity - previousQuantity

        const upsertBalanceResult = await client.query(
          `INSERT INTO inventory_balances (organization_id, warehouse_id, product_id, quantity)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (warehouse_id, product_id)
           DO UPDATE SET
             quantity = EXCLUDED.quantity,
             updated_at = NOW()
           RETURNING
             id,
             organization_id AS "organizationId",
             warehouse_id AS "warehouseId",
             product_id AS "productId",
             quantity::text AS quantity,
             updated_at AS "updatedAt"`,
          [organizationId, input.warehouseId, input.productId, input.newQuantity],
        )

        const adjustmentResult = await client.query(
          `INSERT INTO inventory_adjustments (
             organization_id,
             warehouse_id,
             product_id,
             previous_quantity,
             new_quantity,
             delta,
             reason,
             created_by_user_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING
             id,
             organization_id AS "organizationId",
             warehouse_id AS "warehouseId",
             product_id AS "productId",
             previous_quantity::text AS "previousQuantity",
             new_quantity::text AS "newQuantity",
             delta::text AS delta,
             reason,
             created_by_user_id AS "createdByUserId",
             created_at AS "createdAt"`,
          [
            organizationId,
            input.warehouseId,
            input.productId,
            previousQuantity,
            input.newQuantity,
            delta,
            input.reason.trim(),
            userId,
          ],
        )

        await client.query('COMMIT')

        return reply.code(201).send({
          balance: upsertBalanceResult.rows[0],
          adjustment: adjustmentResult.rows[0],
        })
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )

  app.get(
    '/adjustments',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request, reply) => {
      const query = listInventoryAdjustmentsQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id
      const page = query.page
      const pageSize = query.pageSize

      const whereClauses = ['ia.organization_id = $1']
      const params: Array<string | number | Date> = [organizationId]

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
        whereClauses.push(`ia.warehouse_id = $${params.length}`)
      }

      if (query.productId) {
        const productResult = await pool.query<{ id: string }>(
          `SELECT id
           FROM products
           WHERE organization_id = $1
             AND id = $2
           LIMIT 1`,
          [organizationId, query.productId],
        )

        if (!productResult.rows[0]) {
          return reply.code(404).send({ message: 'Producto no encontrado.' })
        }

        params.push(query.productId)
        whereClauses.push(`ia.product_id = $${params.length}`)
      }

      if (query.from) {
        params.push(query.from)
        whereClauses.push(`ia.created_at >= $${params.length}`)
      }

      if (query.to) {
        params.push(query.to)
        whereClauses.push(`ia.created_at <= $${params.length}`)
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`

      const totalResult = await pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM inventory_adjustments ia
         ${whereSql}`,
        params,
      )

      const total = Number(totalResult.rows[0]?.total ?? 0)
      const offset = (page - 1) * pageSize
      const listParams = [...params, pageSize, offset]
      const limitPlaceholder = `$${listParams.length - 1}`
      const offsetPlaceholder = `$${listParams.length}`

      const result = await pool.query(
        `SELECT
           ia.id,
           ia.warehouse_id AS "warehouseId",
           w.name AS "warehouseName",
           ia.product_id AS "productId",
           p.name AS "productName",
           p.product_type AS "productType",
           p.unit,
           ia.previous_quantity::text AS "previousQuantity",
           ia.new_quantity::text AS "newQuantity",
           ia.delta::text AS delta,
           ia.reason,
           ia.created_by_user_id AS "createdByUserId",
           u.full_name AS "createdByUserName",
           ia.created_at AS "createdAt"
         FROM inventory_adjustments ia
         JOIN warehouses w
           ON w.id = ia.warehouse_id
          AND w.organization_id = ia.organization_id
         JOIN products p
           ON p.id = ia.product_id
          AND p.organization_id = ia.organization_id
         JOIN users u
           ON u.id = ia.created_by_user_id
         ${whereSql}
         ORDER BY ia.created_at DESC
         LIMIT ${limitPlaceholder}
         OFFSET ${offsetPlaceholder}`,
        listParams,
      )

      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)

      return {
        adjustments: result.rows,
        pagination: {
          total,
          page,
          pageSize,
          totalPages,
        },
      }
    },
  )
}
