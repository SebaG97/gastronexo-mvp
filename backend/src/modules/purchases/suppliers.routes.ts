import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

const listSuppliersQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const supplierIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const createSupplierSchema = z.object({
  name: z.string().trim().min(2).max(160),
  taxId: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(160).optional(),
  address: z.string().trim().max(240).optional(),
  notes: z.string().trim().max(600).optional(),
})

const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    taxId: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().max(80).nullable().optional(),
    email: z.string().trim().email().max(160).nullable().optional(),
    address: z.string().trim().max(240).nullable().optional(),
    notes: z.string().trim().max(600).nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar.',
  })

const updateSupplierStatusSchema = z.object({
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

export const suppliersRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => {
      const query = listSuppliersQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id
      const page = query.page
      const pageSize = query.pageSize

      const whereClauses = ['organization_id = $1']
      const params: Array<string | number | boolean> = [organizationId]

      if (query.status === 'active') {
        whereClauses.push('is_active = true')
      } else if (query.status === 'inactive') {
        whereClauses.push('is_active = false')
      }

      if (query.q) {
        params.push(`%${query.q}%`)
        const searchPlaceholder = `$${params.length}`
        whereClauses.push(
          `(name ILIKE ${searchPlaceholder} OR COALESCE(tax_id, '') ILIKE ${searchPlaceholder} OR COALESCE(email, '') ILIKE ${searchPlaceholder})`,
        )
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`

      const totalResult = await pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM suppliers
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
           tax_id AS "taxId",
           phone,
           email,
           address,
           notes,
           is_active AS "isActive",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
         FROM suppliers
         ${whereSql}
         ORDER BY name ASC
         LIMIT ${limitPlaceholder}
         OFFSET ${offsetPlaceholder}`,
        listParams,
      )

      return {
        suppliers: listResult.rows,
        pagination: {
          total,
          page,
          pageSize,
          totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        },
      }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createSupplierSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      try {
        const result = await pool.query(
          `INSERT INTO suppliers (
             organization_id,
             name,
             tax_id,
             phone,
             email,
             address,
             notes
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING
             id,
             name,
             tax_id AS "taxId",
             phone,
             email,
             address,
             notes,
             is_active AS "isActive",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          [
            organizationId,
            input.name,
            normalizeOptionalText(input.taxId),
            normalizeOptionalText(input.phone),
            normalizeOptionalText(input.email),
            normalizeOptionalText(input.address),
            normalizeOptionalText(input.notes),
          ],
        )

        return reply.code(201).send({ supplier: result.rows[0] })
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe un proveedor con ese nombre.' })
        }

        throw error
      }
    },
  )

  app.patch(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = supplierIdParamsSchema.parse(request.params)
      const input = updateSupplierSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      const assignments: string[] = []
      const params: Array<string | null> = [organizationId, id]

      if (input.name !== undefined) {
        params.push(input.name)
        assignments.push(`name = $${params.length}`)
      }

      if (input.taxId !== undefined) {
        params.push(normalizeOptionalText(input.taxId))
        assignments.push(`tax_id = $${params.length}`)
      }

      if (input.phone !== undefined) {
        params.push(normalizeOptionalText(input.phone))
        assignments.push(`phone = $${params.length}`)
      }

      if (input.email !== undefined) {
        params.push(normalizeOptionalText(input.email))
        assignments.push(`email = $${params.length}`)
      }

      if (input.address !== undefined) {
        params.push(normalizeOptionalText(input.address))
        assignments.push(`address = $${params.length}`)
      }

      if (input.notes !== undefined) {
        params.push(normalizeOptionalText(input.notes))
        assignments.push(`notes = $${params.length}`)
      }

      assignments.push('updated_at = NOW()')

      try {
        const result = await pool.query(
          `UPDATE suppliers
           SET ${assignments.join(', ')}
           WHERE organization_id = $1
             AND id = $2
           RETURNING
             id,
             name,
             tax_id AS "taxId",
             phone,
             email,
             address,
             notes,
             is_active AS "isActive",
             created_at AS "createdAt",
             updated_at AS "updatedAt"`,
          params,
        )

        const supplier = result.rows[0]
        if (!supplier) {
          return reply.code(404).send({ message: 'Proveedor no encontrado.' })
        }

        return { supplier }
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe un proveedor con ese nombre.' })
        }

        throw error
      }
    },
  )

  app.patch(
    '/:id/status',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = supplierIdParamsSchema.parse(request.params)
      const input = updateSupplierStatusSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      const result = await pool.query(
        `UPDATE suppliers
         SET is_active = $3,
             updated_at = NOW()
         WHERE organization_id = $1
           AND id = $2
         RETURNING
           id,
           name,
           tax_id AS "taxId",
           phone,
           email,
           address,
           notes,
           is_active AS "isActive",
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [organizationId, id, input.isActive],
      )

      const supplier = result.rows[0]
      if (!supplier) {
        return reply.code(404).send({ message: 'Proveedor no encontrado.' })
      }

      return { supplier }
    },
  )
}
