import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

const listWarehousesQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'all']).default('active'),
})

const warehouseIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const createWarehouseSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

const updateWarehouseSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

const updateWarehouseStatusSchema = z.object({
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

export const warehousesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => {
      const query = listWarehousesQuerySchema.parse(request.query)
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
        `SELECT
           id,
           name,
           is_active AS "isActive",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM warehouses
         ${whereSql}
         ORDER BY name ASC`,
        params,
      )

      return { warehouses: result.rows }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createWarehouseSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      try {
        const result = await pool.query(
          `INSERT INTO warehouses (organization_id, name)
           VALUES ($1, $2)
           RETURNING
             id,
             name,
             is_active AS "isActive",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          [organizationId, input.name],
        )

        return reply.code(201).send({ warehouse: result.rows[0] })
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe un depósito con ese nombre.' })
        }

        throw error
      }
    },
  )

  app.patch(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = warehouseIdParamsSchema.parse(request.params)
      const input = updateWarehouseSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      try {
        const result = await pool.query(
          `UPDATE warehouses
           SET name = $3,
               updated_at = NOW()
           WHERE organization_id = $1
             AND id = $2
           RETURNING
             id,
             name,
             is_active AS "isActive",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          [organizationId, id, input.name],
        )

        const warehouse = result.rows[0]
        if (!warehouse) {
          return reply.code(404).send({ message: 'Depósito no encontrado.' })
        }

        return { warehouse }
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe un depósito con ese nombre.' })
        }

        throw error
      }
    },
  )

  app.patch(
    '/:id/status',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = warehouseIdParamsSchema.parse(request.params)
      const input = updateWarehouseStatusSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const warehouseResult = await client.query<{ id: string; isActive: boolean }>(
          `SELECT id, is_active AS "isActive"
           FROM warehouses
           WHERE organization_id = $1
             AND id = $2
           LIMIT 1`,
          [organizationId, id],
        )

        const warehouse = warehouseResult.rows[0]

        if (!warehouse) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Depósito no encontrado.' })
        }

        if (!input.isActive) {
          const positiveBalanceResult = await client.query<{ total: string }>(
            `SELECT COUNT(*)::text AS total
             FROM inventory_balances
             WHERE organization_id = $1
               AND warehouse_id = $2
               AND quantity > 0`,
            [organizationId, id],
          )

          const positiveBalanceCount = Number(positiveBalanceResult.rows[0]?.total ?? '0')
          if (positiveBalanceCount > 0) {
            await rollbackTransaction(client)
            return reply
              .code(409)
              .send({
                message:
                  'No se puede inactivar el depósito porque tiene inventario positivo. Ajustá el stock a 0 antes de inactivarlo.',
              })
          }
        }

        const updateResult = await client.query(
          `UPDATE warehouses
           SET is_active = $3,
               updated_at = NOW()
           WHERE organization_id = $1
             AND id = $2
           RETURNING
             id,
             name,
             is_active AS "isActive",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          [organizationId, id, input.isActive],
        )

        await client.query('COMMIT')

        return { warehouse: updateResult.rows[0] }
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )
}
