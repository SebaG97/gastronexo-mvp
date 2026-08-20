import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  sku: z.string().trim().min(1).max(80).optional(),
  unit: z.string().trim().min(1).max(24).default('unit'),
  cost: z.coerce.number().min(0).default(0),
})

export const productsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => {
      const organizationId = request.organizationAccess!.organization.id

    const result = await pool.query(
      `SELECT id, name, sku, unit, cost, is_active AS "isActive", created_at AS "createdAt"
       FROM products
       WHERE organization_id = $1
       ORDER BY name ASC`,
      [organizationId],
    )

    return { products: result.rows }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = productSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      try {
        const result = await pool.query(
          `INSERT INTO products (organization_id, name, sku, unit, cost)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, sku, unit, cost, is_active AS "isActive", created_at AS "createdAt"`,
          [organizationId, input.name, input.sku ?? null, input.unit, input.cost],
        )

        return reply.code(201).send({ product: result.rows[0] })
      } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
          return reply.code(409).send({ message: 'Ya existe un producto con ese SKU.' })
        }
        throw error
      }
    },
  )
}
