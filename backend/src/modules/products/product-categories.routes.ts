import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

const listCategoriesQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'all']).default('active'),
})

const categoryIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
})

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
})

const updateCategoryStatusSchema = z.object({
  isActive: z.boolean(),
})

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

async function rollbackTransaction(client: Pick<typeof pool, 'query'>) {
  try {
    await client.query('ROLLBACK')
  } catch {
    return
  }
}

export const productCategoriesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => {
      const query = listCategoriesQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id

      const whereClauses = ['organization_id = $1']
      const params: Array<string | boolean> = [organizationId]

      if (query.status === 'active') {
        whereClauses.push('is_active = true')
      } else if (query.status === 'inactive') {
        whereClauses.push('is_active = false')
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`
      const result = await pool.query(
        `SELECT id, name, is_active AS "isActive", created_at AS "createdAt"
         FROM product_categories
         ${whereSql}
         ORDER BY name ASC`,
        params,
      )

      return { categories: result.rows }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createCategorySchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      try {
        const result = await pool.query(
          `INSERT INTO product_categories (organization_id, name)
           VALUES ($1, $2)
           RETURNING id, name, is_active AS "isActive", created_at AS "createdAt"`,
          [organizationId, input.name],
        )

        return reply.code(201).send({ category: result.rows[0] })
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe una categoría con ese nombre.' })
        }

        throw error
      }
    },
  )

  app.patch(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = categoryIdParamsSchema.parse(request.params)
      const input = updateCategorySchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      try {
        const result = await pool.query(
          `UPDATE product_categories
           SET name = $3,
               updated_at = NOW()
           WHERE organization_id = $1
             AND id = $2
           RETURNING id, name, is_active AS "isActive", created_at AS "createdAt"`,
          [organizationId, id, input.name],
        )

        const category = result.rows[0]
        if (!category) {
          return reply.code(404).send({ message: 'Categoría no encontrada.' })
        }

        return { category }
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe una categoría con ese nombre.' })
        }

        throw error
      }
    },
  )

  app.patch(
    '/:id/status',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = categoryIdParamsSchema.parse(request.params)
      const input = updateCategoryStatusSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const categoryResult = await client.query<{ id: string; isActive: boolean }>(
          `SELECT id, is_active AS "isActive"
           FROM product_categories
           WHERE organization_id = $1
             AND id = $2
           LIMIT 1`,
          [organizationId, id],
        )
        const category = categoryResult.rows[0]

        if (!category) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Categoría no encontrada.' })
        }

        if (!input.isActive) {
          const activeProductsResult = await client.query<{ total: string }>(
            `SELECT COUNT(*)::text AS total
             FROM products
             WHERE organization_id = $1
               AND category_id = $2
               AND is_active = true`,
            [organizationId, id],
          )

          const activeProductsCount = Number(activeProductsResult.rows[0]?.total ?? '0')
          if (activeProductsCount > 0) {
            await rollbackTransaction(client)
            return reply
              .code(409)
              .send({
                message:
                  'No se puede inactivar la categoría porque tiene productos activos asociados. Primero reasigná o inactivá esos productos.',
              })
          }
        }

        const updateResult = await client.query(
          `UPDATE product_categories
           SET is_active = $3,
               updated_at = NOW()
           WHERE organization_id = $1
             AND id = $2
           RETURNING id, name, is_active AS "isActive", created_at AS "createdAt"`,
          [organizationId, id, input.isActive],
        )

        await client.query('COMMIT')
        return { category: updateResult.rows[0] }
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )
}
