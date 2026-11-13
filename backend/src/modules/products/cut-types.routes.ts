import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

const listCutTypesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
})

const cutTypeIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const createCutTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
})

const updateCutTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar.',
  })

const updateCutTypeStatusSchema = z.object({
  isActive: z.boolean(),
})

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null
  }

  const normalized = value.trim()
  return normalized.length ? normalized : null
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

export const cutTypesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => {
      const query = listCutTypesQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id

      const whereClauses = ['organization_id = $1']
      const params: Array<string> = [organizationId]

      if (query.status === 'active') {
        whereClauses.push('is_active = true')
      } else if (query.status === 'inactive') {
        whereClauses.push('is_active = false')
      }

      if (query.q) {
        params.push(`%${query.q}%`)
        const searchPlaceholder = `$${params.length}`
        whereClauses.push(`(name ILIKE ${searchPlaceholder} OR COALESCE(description, '') ILIKE ${searchPlaceholder})`)
      }

      const result = await pool.query(
        `SELECT
           id,
           name,
           description,
           is_active AS "isActive",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM cut_types
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY name ASC`,
        params,
      )

      return { cutTypes: result.rows }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createCutTypeSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      try {
        const result = await pool.query(
          `INSERT INTO cut_types (organization_id, name, description)
           VALUES ($1, $2, $3)
           RETURNING
             id,
             name,
             description,
             is_active AS "isActive",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          [organizationId, input.name, normalizeOptionalText(input.description)],
        )

        return reply.code(201).send({ cutType: result.rows[0] })
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe un tipo de corte con ese nombre.' })
        }

        throw error
      }
    },
  )

  app.patch(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = cutTypeIdParamsSchema.parse(request.params)
      const input = updateCutTypeSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const assignments: string[] = []
      const values: Array<string | null> = [organizationId, id]

      if (input.name !== undefined) {
        values.push(input.name)
        assignments.push(`name = $${values.length}`)
      }

      if (input.description !== undefined) {
        values.push(normalizeOptionalText(input.description))
        assignments.push(`description = $${values.length}`)
      }

      assignments.push('updated_at = NOW()')

      try {
        const result = await pool.query(
          `UPDATE cut_types
           SET ${assignments.join(', ')}
           WHERE organization_id = $1
             AND id = $2
           RETURNING
             id,
             name,
             description,
             is_active AS "isActive",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          values,
        )

        const cutType = result.rows[0]
        if (!cutType) {
          return reply.code(404).send({ message: 'Tipo de corte no encontrado.' })
        }

        return { cutType }
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe un tipo de corte con ese nombre.' })
        }

        throw error
      }
    },
  )

  app.patch(
    '/:id/status',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = cutTypeIdParamsSchema.parse(request.params)
      const input = updateCutTypeStatusSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      const result = await pool.query(
        `UPDATE cut_types
         SET is_active = $3,
             updated_at = NOW()
         WHERE organization_id = $1
           AND id = $2
         RETURNING
           id,
           name,
           description,
           is_active AS "isActive",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [organizationId, id, input.isActive],
      )

      const cutType = result.rows[0]
      if (!cutType) {
        return reply.code(404).send({ message: 'Tipo de corte no encontrado.' })
      }

      return { cutType }
    },
  )
}
