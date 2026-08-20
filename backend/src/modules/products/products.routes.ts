import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'

const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  sku: z.string().trim().min(1).max(80).optional(),
  unit: z.string().trim().min(1).max(24).default('unit'),
  cost: z.coerce.number().min(0).default(0),
})

export const productsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request) => {
    await request.jwtVerify()
  })

  app.get('/', async (request) => {
    const result = await pool.query(
      `SELECT id, name, sku, unit, cost, is_active AS "isActive", created_at AS "createdAt"
       FROM products
       WHERE organization_id = $1
       ORDER BY name ASC`,
      [request.user.organizationId],
    )

    return { products: result.rows }
  })

  app.post('/', async (request, reply) => {
    const input = productSchema.parse(request.body)

    try {
      const result = await pool.query(
        `INSERT INTO products (organization_id, name, sku, unit, cost)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, sku, unit, cost, is_active AS "isActive", created_at AS "createdAt"`,
        [request.user.organizationId, input.name, input.sku ?? null, input.unit, input.cost],
      )

      return reply.code(201).send({ product: result.rows[0] })
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        return reply.code(409).send({ message: 'Ya existe un producto con ese SKU.' })
      }
      throw error
    }
  })
}
