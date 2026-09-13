import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

const listCustomersQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const customerIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  businessName: z.string().trim().max(160).optional(),
  documentNumber: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(160).optional(),
  notes: z.string().trim().max(600).optional(),
})

const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    businessName: z.string().trim().max(160).nullable().optional(),
    documentNumber: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().max(80).nullable().optional(),
    email: z.string().trim().email().max(160).nullable().optional(),
    notes: z.string().trim().max(600).nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar.',
  })

const updateCustomerStatusSchema = z.object({
  isActive: z.boolean(),
})

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

async function getCustomerById(organizationId: string, customerId: string) {
  const result = await pool.query(
    `SELECT
       id,
       name,
       business_name AS "businessName",
       document_number AS "documentNumber",
       phone,
       email,
       notes,
       is_active AS "isActive",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM customers
     WHERE organization_id = $1
       AND id = $2
     LIMIT 1`,
    [organizationId, customerId],
  )

  return result.rows[0] ?? null
}

export const customersRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => {
      const query = listCustomersQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id
      const page = query.page
      const pageSize = query.pageSize

      const whereClauses = ['organization_id = $1']
      const params: Array<string | number> = [organizationId]

      if (query.status === 'active') {
        whereClauses.push('is_active = true')
      } else if (query.status === 'inactive') {
        whereClauses.push('is_active = false')
      }

      if (query.q) {
        params.push(`%${query.q}%`)
        const searchPlaceholder = `$${params.length}`
        whereClauses.push(
          `(name ILIKE ${searchPlaceholder} OR COALESCE(business_name, '') ILIKE ${searchPlaceholder} OR COALESCE(document_number, '') ILIKE ${searchPlaceholder} OR COALESCE(email, '') ILIKE ${searchPlaceholder})`,
        )
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`
      const totalResult = await pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM customers
         ${whereSql}`,
        params,
      )

      const total = Number(totalResult.rows[0]?.total ?? 0)
      const offset = (page - 1) * pageSize
      const listParams = [...params, pageSize, offset]
      const limitPlaceholder = `$${listParams.length - 1}`
      const offsetPlaceholder = `$${listParams.length}`

      const listResult = await pool.query(
        `SELECT
           id,
           name,
           business_name AS "businessName",
           document_number AS "documentNumber",
           phone,
           email,
           notes,
           is_active AS "isActive",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM customers
         ${whereSql}
         ORDER BY name ASC
         LIMIT ${limitPlaceholder}
         OFFSET ${offsetPlaceholder}`,
        listParams,
      )

      return {
        customers: listResult.rows,
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
      const { id } = customerIdParamsSchema.parse(request.params)
      const organizationId = request.organizationAccess!.organization.id
      const customer = await getCustomerById(organizationId, id)

      if (!customer) {
        return reply.code(404).send({ message: 'Cliente no encontrado.' })
      }

      return { customer }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createCustomerSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      try {
        const result = await pool.query(
          `INSERT INTO customers (
             organization_id,
             name,
             business_name,
             document_number,
             phone,
             email,
             notes
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING
             id,
             name,
             business_name AS "businessName",
             document_number AS "documentNumber",
             phone,
             email,
             notes,
             is_active AS "isActive",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          [
            organizationId,
            input.name,
            normalizeOptionalText(input.businessName),
            normalizeOptionalText(input.documentNumber),
            normalizeOptionalText(input.phone),
            normalizeOptionalText(input.email),
            normalizeOptionalText(input.notes),
          ],
        )

        return reply.code(201).send({ customer: result.rows[0] })
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe un cliente con ese nombre.' })
        }

        throw error
      }
    },
  )

  app.patch(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = customerIdParamsSchema.parse(request.params)
      const input = updateCustomerSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      const assignments: string[] = []
      const params: Array<string | null> = [organizationId, id]

      if (input.name !== undefined) {
        params.push(input.name)
        assignments.push(`name = $${params.length}`)
      }
      if (input.businessName !== undefined) {
        params.push(normalizeOptionalText(input.businessName))
        assignments.push(`business_name = $${params.length}`)
      }
      if (input.documentNumber !== undefined) {
        params.push(normalizeOptionalText(input.documentNumber))
        assignments.push(`document_number = $${params.length}`)
      }
      if (input.phone !== undefined) {
        params.push(normalizeOptionalText(input.phone))
        assignments.push(`phone = $${params.length}`)
      }
      if (input.email !== undefined) {
        params.push(normalizeOptionalText(input.email))
        assignments.push(`email = $${params.length}`)
      }
      if (input.notes !== undefined) {
        params.push(normalizeOptionalText(input.notes))
        assignments.push(`notes = $${params.length}`)
      }

      assignments.push('updated_at = NOW()')

      try {
        const result = await pool.query(
          `UPDATE customers
           SET ${assignments.join(', ')}
           WHERE organization_id = $1
             AND id = $2
           RETURNING
             id,
             name,
             business_name AS "businessName",
             document_number AS "documentNumber",
             phone,
             email,
             notes,
             is_active AS "isActive",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          params,
        )

        const customer = result.rows[0]
        if (!customer) {
          return reply.code(404).send({ message: 'Cliente no encontrado.' })
        }

        return { customer }
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe un cliente con ese nombre.' })
        }

        throw error
      }
    },
  )

  app.patch(
    '/:id/status',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = customerIdParamsSchema.parse(request.params)
      const input = updateCustomerStatusSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      const result = await pool.query(
        `UPDATE customers
         SET is_active = $3,
             updated_at = NOW()
         WHERE organization_id = $1
           AND id = $2
         RETURNING
           id,
           name,
           business_name AS "businessName",
           document_number AS "documentNumber",
           phone,
           email,
           notes,
           is_active AS "isActive",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [organizationId, id, input.isActive],
      )

      const customer = result.rows[0]
      if (!customer) {
        return reply.code(404).send({ message: 'Cliente no encontrado.' })
      }

      return { customer }
    },
  )
}
