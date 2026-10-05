import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

// Una venta es un pedido entregado; el periodo se mide por la fecha de entrega.
const listSalesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const salesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => {
      const query = listSalesQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id
      const page = query.page
      const pageSize = query.pageSize

      const whereClauses = ['o.organization_id = $1', "o.status = 'delivered'"]
      const params: Array<string | number | Date> = [organizationId]

      if (query.from) {
        params.push(query.from)
        whereClauses.push(`o.delivered_at >= $${params.length}`)
      }
      if (query.to) {
        params.push(query.to)
        whereClauses.push(`o.delivered_at <= $${params.length}`)
      }
      if (query.q) {
        params.push(`%${query.q}%`)
        const searchPlaceholder = `$${params.length}`
        whereClauses.push(`(o.order_number ILIKE ${searchPlaceholder} OR c.name ILIKE ${searchPlaceholder})`)
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`

      const summaryResult = await pool.query<{ count: number; total: string }>(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(o.total), 0)::text AS total
         FROM orders o
         JOIN customers c
           ON c.id = o.customer_id
          AND c.organization_id = o.organization_id
         ${whereSql}`,
        params,
      )

      const count = Number(summaryResult.rows[0]?.count ?? 0)
      const offset = (page - 1) * pageSize
      const listParams = [...params, pageSize, offset]
      const limitPlaceholder = `$${listParams.length - 1}`
      const offsetPlaceholder = `$${listParams.length}`

      const salesResult = await pool.query(
        `SELECT
           o.id,
           o.order_number AS "orderNumber",
           o.customer_id AS "customerId",
           c.name AS "customerName",
           o.order_date AS "orderDate",
           o.delivered_at AS "deliveredAt",
           o.warehouse_id AS "warehouseId",
           w.name AS "warehouseName",
           o.total::text AS total,
           (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS "itemCount"
         FROM orders o
         JOIN customers c
           ON c.id = o.customer_id
          AND c.organization_id = o.organization_id
         LEFT JOIN warehouses w
           ON w.id = o.warehouse_id
          AND w.organization_id = o.organization_id
         ${whereSql}
         ORDER BY o.delivered_at DESC, o.order_number DESC
         LIMIT ${limitPlaceholder}
         OFFSET ${offsetPlaceholder}`,
        listParams,
      )

      return {
        sales: salesResult.rows,
        summary: {
          count,
          total: summaryResult.rows[0]?.total ?? '0',
        },
        pagination: {
          total: count,
          page,
          pageSize,
          totalPages: count === 0 ? 0 : Math.ceil(count / pageSize),
        },
      }
    },
  )
}
