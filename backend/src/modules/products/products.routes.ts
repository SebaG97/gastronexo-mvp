import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

const allowedProductUnits = ['unit', 'kg', 'g', 'l', 'ml', 'box', 'portion'] as const
const allowedProductTypes = ['raw_material', 'finished_product'] as const

const productUnitSchema = z.enum(allowedProductUnits)
const productTypeSchema = z.enum(allowedProductTypes)

const listProductsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  productType: productTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const productIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(160),
  sku: z.string().trim().min(1).max(80).optional(),
  unit: productUnitSchema.default('unit'),
  productType: productTypeSchema.default('raw_material'),
  cost: z.coerce.number().min(0).default(0),
  categoryId: z.string().uuid().nullable().optional(),
})

const updateProductSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    sku: z.string().trim().max(80).nullable().optional(),
    unit: productUnitSchema.optional(),
    productType: productTypeSchema.optional(),
    cost: z.coerce.number().min(0).optional(),
    categoryId: z.string().uuid().nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar.',
  })

const updateProductStatusSchema = z.object({
  isActive: z.boolean(),
})

function normalizeSku(sku: string | null | undefined) {
  if (sku === undefined || sku === null) {
    return null
  }

  const normalized = sku.trim()
  return normalized.length ? normalized : null
}

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

async function categoryExistsAndIsActive(
  client: Pick<typeof pool, 'query'>,
  organizationId: string,
  categoryId: string,
) {
  const categoryResult = await client.query(
    `SELECT id
     FROM product_categories
     WHERE organization_id = $1
       AND id = $2
       AND is_active = true
     LIMIT 1`,
    [organizationId, categoryId],
  )

  return Boolean(categoryResult.rows[0])
}

async function getCategoryName(client: Pick<typeof pool, 'query'>, organizationId: string, categoryId: string) {
  const categoryResult = await client.query<{ name: string }>(
    `SELECT name
     FROM product_categories
     WHERE organization_id = $1
       AND id = $2
     LIMIT 1`,
    [organizationId, categoryId],
  )

  return categoryResult.rows[0]?.name ?? null
}

export const productsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => {
      const query = listProductsQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id
      const page = query.page
      const pageSize = query.pageSize
      const searchTerm = query.q?.trim()

      const whereClauses = ['p.organization_id = $1']
      const params: Array<string | number | boolean> = [organizationId]

      if (query.status === 'active') {
        whereClauses.push('is_active = true')
      } else if (query.status === 'inactive') {
        whereClauses.push('is_active = false')
      }

      if (query.productType) {
        params.push(query.productType)
        whereClauses.push(`p.product_type = $${params.length}`)
      }

      if (searchTerm) {
        params.push(`%${searchTerm}%`)
        const searchPlaceholder = `$${params.length}`
        whereClauses.push(
          `(p.name ILIKE ${searchPlaceholder} OR COALESCE(p.sku, '') ILIKE ${searchPlaceholder})`,
        )
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`

      const totalResult = await pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM products p
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
           p.id,
           p.name,
           p.sku,
           p.unit,
           p.product_type AS "productType",
           p.cost,
           p.category_id AS "categoryId",
           c.name AS "categoryName",
           p.is_active AS "isActive",
           p.created_at AS "createdAt"
         FROM products p
         LEFT JOIN product_categories c
           ON c.id = p.category_id
          AND c.organization_id = p.organization_id
         ${whereSql}
         ORDER BY p.name ASC
         LIMIT ${limitPlaceholder}
         OFFSET ${offsetPlaceholder}`,
        listParams,
      )

      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)

      return {
        products: result.rows,
        pagination: {
          total,
          page,
          pageSize,
          totalPages,
        },
      }
    },
  )

  app.get(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request, reply) => {
      const { id } = productIdParamsSchema.parse(request.params)
      const organizationId = request.organizationAccess!.organization.id

      const result = await pool.query(
        `SELECT
           p.id,
           p.name,
           p.sku,
           p.unit,
           p.product_type AS "productType",
           p.cost,
           p.category_id AS "categoryId",
           c.name AS "categoryName",
           p.is_active AS "isActive",
           p.created_at AS "createdAt"
         FROM products p
         LEFT JOIN product_categories c
           ON c.id = p.category_id
          AND c.organization_id = p.organization_id
         WHERE p.organization_id = $1
           AND p.id = $2
         LIMIT 1`,
        [organizationId, id],
      )

      const product = result.rows[0]

      if (!product) {
        return reply.code(404).send({ message: 'Producto no encontrado.' })
      }

      return { product }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createProductSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        if (input.categoryId) {
          const categoryExists = await categoryExistsAndIsActive(client, organizationId, input.categoryId)
          if (!categoryExists) {
            await rollbackTransaction(client)
            return reply.code(404).send({ message: 'Categoría no encontrada.' })
          }
        }

        const sku = normalizeSku(input.sku)
        const result = await client.query(
          `INSERT INTO products (organization_id, name, sku, unit, product_type, cost, category_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING
             id,
             name,
             sku,
             unit,
             product_type AS "productType",
             cost,
             category_id AS "categoryId",
             is_active AS "isActive",
             created_at AS "createdAt"`,
          [
            organizationId,
            input.name,
            sku,
            input.unit,
            input.productType,
            input.cost,
            input.categoryId ?? null,
          ],
        )

        const product = result.rows[0]
        product.categoryName = product.categoryId
          ? await getCategoryName(client, organizationId, product.categoryId)
          : null

        await client.query('COMMIT')

        return reply.code(201).send({ product })
      } catch (error: unknown) {
        await rollbackTransaction(client)
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe un producto con ese SKU.' })
        }
        throw error
      } finally {
        client.release()
      }
    },
  )

  app.patch(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = productIdParamsSchema.parse(request.params)
      const input = updateProductSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      const assignments: string[] = []
      const values: Array<string | number | boolean | null> = [organizationId, id]

      if (input.name !== undefined) {
        values.push(input.name)
        assignments.push(`name = $${values.length}`)
      }

      if (input.sku !== undefined) {
        values.push(normalizeSku(input.sku))
        assignments.push(`sku = $${values.length}`)
      }

      if (input.unit !== undefined) {
        values.push(input.unit)
        assignments.push(`unit = $${values.length}`)
      }

      if (input.productType !== undefined) {
        values.push(input.productType)
        assignments.push(`product_type = $${values.length}`)
      }

      if (input.cost !== undefined) {
        values.push(input.cost)
        assignments.push(`cost = $${values.length}`)
      }

      if (input.categoryId !== undefined) {
        values.push(input.categoryId)
        assignments.push(`category_id = $${values.length}`)
      }

      assignments.push('updated_at = NOW()')

      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        if (input.categoryId) {
          const categoryExists = await categoryExistsAndIsActive(client, organizationId, input.categoryId)
          if (!categoryExists) {
            await rollbackTransaction(client)
            return reply.code(404).send({ message: 'Categoría no encontrada.' })
          }
        }

        const result = await client.query(
          `UPDATE products
           SET ${assignments.join(', ')}
           WHERE organization_id = $1
             AND id = $2
           RETURNING
             id,
             name,
             sku,
             unit,
             product_type AS "productType",
             cost,
             category_id AS "categoryId",
             is_active AS "isActive",
             created_at AS "createdAt"`,
          values,
        )

        const product = result.rows[0]
        if (!product) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Producto no encontrado.' })
        }

        product.categoryName = product.categoryId
          ? await getCategoryName(client, organizationId, product.categoryId)
          : null

        await client.query('COMMIT')

        return { product }
      } catch (error: unknown) {
        await rollbackTransaction(client)
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe un producto con ese SKU.' })
        }
        throw error
      } finally {
        client.release()
      }
    },
  )

  app.patch(
    '/:id/status',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = productIdParamsSchema.parse(request.params)
      const input = updateProductStatusSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      const result = await pool.query(
        `UPDATE products
         SET is_active = $3,
             updated_at = NOW()
         WHERE organization_id = $1
           AND id = $2
         RETURNING
           id,
           name,
           sku,
           unit,
           product_type AS "productType",
           cost,
           category_id AS "categoryId",
           is_active AS "isActive",
           created_at AS "createdAt"`,
        [organizationId, id, input.isActive],
      )

      const product = result.rows[0]
      if (!product) {
        return reply.code(404).send({ message: 'Producto no encontrado.' })
      }

      product.categoryName = product.categoryId
        ? await getCategoryName(pool, organizationId, product.categoryId)
        : null

      return { product }
    },
  )
}
