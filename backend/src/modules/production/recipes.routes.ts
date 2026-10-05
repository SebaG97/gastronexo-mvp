import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'

type DbClient = Pick<typeof pool, 'query'>

const recipeIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const listRecipesQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const recipeItemSchema = z.object({
  ingredientProductId: z.string().uuid(),
  quantity: z.coerce.number().positive().max(99_999_999),
})

const recipeItemsSchema = z
  .array(recipeItemSchema)
  .min(1)
  .max(100)
  .refine(
    (items) => new Set(items.map((item) => item.ingredientProductId)).size === items.length,
    { message: 'La receta no puede repetir ingredientes.' },
  )

const createRecipeSchema = z.object({
  productId: z.string().uuid(),
  yieldQuantity: z.coerce.number().positive().max(99_999_999),
  notes: z.string().trim().max(600).nullable().optional(),
  items: recipeItemsSchema,
})

const updateRecipeSchema = z
  .object({
    yieldQuantity: z.coerce.number().positive().max(99_999_999).optional(),
    notes: z.string().trim().max(600).nullable().optional(),
    items: recipeItemsSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar.',
  })

const updateRecipeStatusSchema = z.object({
  isActive: z.boolean(),
})

const ACTIVE_RECIPE_EXISTS_MESSAGE = 'El producto ya tiene una receta activa. Inactivala o editala.'

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function roundQuantity(value: number) {
  return Number(value.toFixed(3))
}

async function rollbackTransaction(client: DbClient) {
  try {
    await client.query('ROLLBACK')
  } catch {
    return
  }
}

/** El producto de la receta debe ser un terminado activo de la organizacion. */
async function validateRecipeProduct(client: DbClient, organizationId: string, productId: string) {
  const result = await client.query<{ isActive: boolean; productType: string }>(
    `SELECT is_active AS "isActive", product_type AS "productType"
     FROM products
     WHERE organization_id = $1
       AND id = $2
     LIMIT 1`,
    [organizationId, productId],
  )

  const product = result.rows[0]
  if (!product) {
    return { ok: false as const, statusCode: 404, message: 'Producto no encontrado.' }
  }

  if (product.productType !== 'finished_product' || !product.isActive) {
    return {
      ok: false as const,
      statusCode: 400,
      message: 'La receta debe ser de un producto terminado activo.',
    }
  }

  return { ok: true as const }
}

/** Los ingredientes deben ser materias primas activas de la organizacion. */
async function validateIngredients(client: DbClient, organizationId: string, ingredientIds: string[]) {
  const result = await client.query<{ id: string; isActive: boolean; productType: string }>(
    `SELECT id, is_active AS "isActive", product_type AS "productType"
     FROM products
     WHERE organization_id = $1
       AND id = ANY($2::uuid[])`,
    [organizationId, ingredientIds],
  )

  if (result.rows.length !== ingredientIds.length) {
    return { ok: false as const, statusCode: 404, message: 'Ingrediente no encontrado.' }
  }

  if (result.rows.some((product) => product.productType !== 'raw_material' || !product.isActive)) {
    return {
      ok: false as const,
      statusCode: 400,
      message: 'Los ingredientes deben ser materias primas activas.',
    }
  }

  return { ok: true as const }
}

async function replaceRecipeItems(
  client: DbClient,
  organizationId: string,
  recipeId: string,
  items: Array<{ ingredientProductId: string; quantity: number }>,
) {
  await client.query('DELETE FROM recipe_items WHERE organization_id = $1 AND recipe_id = $2', [
    organizationId,
    recipeId,
  ])

  const rowsSql = items
    .map((_item, index) => `($1, $2, $${index * 2 + 3}, $${index * 2 + 4})`)
    .join(', ')
  const params: Array<string | number> = [organizationId, recipeId]
  for (const item of items) {
    params.push(item.ingredientProductId, roundQuantity(item.quantity))
  }

  await client.query(
    `INSERT INTO recipe_items (organization_id, recipe_id, ingredient_product_id, quantity)
     VALUES ${rowsSql}`,
    params,
  )
}

export async function getRecipeById(client: DbClient, organizationId: string, recipeId: string) {
  const recipeResult = await client.query(
    `SELECT
       r.id,
       r.product_id AS "productId",
       p.name AS "productName",
       p.unit AS "productUnit",
       p.cost::text AS "productCost",
       p.is_active AS "productIsActive",
       r.yield_quantity::text AS "yieldQuantity",
       r.is_active AS "isActive",
       r.notes,
       r.created_by AS "createdBy",
       cu.full_name AS "createdByUserName",
       uu.full_name AS "updatedByUserName",
       r.created_at AS "createdAt",
       r.updated_at AS "updatedAt"
     FROM recipes r
     JOIN products p
       ON p.id = r.product_id
      AND p.organization_id = r.organization_id
     JOIN users cu ON cu.id = r.created_by
     JOIN users uu ON uu.id = r.updated_by
     WHERE r.organization_id = $1
       AND r.id = $2
     LIMIT 1`,
    [organizationId, recipeId],
  )

  const recipe = recipeResult.rows[0]
  if (!recipe) {
    return null
  }

  const itemsResult = await client.query(
    `SELECT
       ri.id,
       ri.ingredient_product_id AS "ingredientProductId",
       p.name AS "productName",
       p.unit,
       p.product_type AS "productType",
       p.is_active AS "isActive",
       p.cost::text AS "unitCost",
       ri.quantity::text AS quantity
     FROM recipe_items ri
     JOIN products p
       ON p.id = ri.ingredient_product_id
      AND p.organization_id = ri.organization_id
     WHERE ri.organization_id = $1
       AND ri.recipe_id = $2
     ORDER BY p.name ASC`,
    [organizationId, recipeId],
  )

  return { ...recipe, items: itemsResult.rows }
}

export const recipesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => {
      const query = listRecipesQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id

      const whereClauses = ['r.organization_id = $1']
      const params: Array<string | number> = [organizationId]

      if (query.status !== 'all') {
        whereClauses.push(query.status === 'active' ? 'r.is_active = TRUE' : 'r.is_active = FALSE')
      }

      if (query.q) {
        params.push(`%${query.q}%`)
        whereClauses.push(`p.name ILIKE $${params.length}`)
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`

      const totalResult = await pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM recipes r
         JOIN products p
           ON p.id = r.product_id
          AND p.organization_id = r.organization_id
         ${whereSql}`,
        params,
      )

      const total = Number(totalResult.rows[0]?.total ?? 0)
      const listParams = [...params, query.pageSize, (query.page - 1) * query.pageSize]

      const result = await pool.query(
        `SELECT
           r.id,
           r.product_id AS "productId",
           p.name AS "productName",
           p.unit AS "productUnit",
           r.yield_quantity::text AS "yieldQuantity",
           r.is_active AS "isActive",
           r.notes,
           (SELECT COUNT(*)::int FROM recipe_items ri WHERE ri.recipe_id = r.id) AS "itemCount",
           r.created_at AS "createdAt",
           r.updated_at AS "updatedAt"
         FROM recipes r
         JOIN products p
           ON p.id = r.product_id
          AND p.organization_id = r.organization_id
         ${whereSql}
         ORDER BY r.is_active DESC, p.name ASC, r.updated_at DESC
         LIMIT $${listParams.length - 1}
         OFFSET $${listParams.length}`,
        listParams,
      )

      return {
        recipes: result.rows,
        pagination: {
          total,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
        },
      }
    },
  )

  app.get(
    '/:id',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request, reply) => {
      const { id } = recipeIdParamsSchema.parse(request.params)
      const organizationId = request.organizationAccess!.organization.id

      const recipe = await getRecipeById(pool, organizationId, id)
      if (!recipe) {
        return reply.code(404).send({ message: 'Receta no encontrada.' })
      }

      return { recipe }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createRecipeSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const userId = request.organizationAccess!.user.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const productCheck = await validateRecipeProduct(client, organizationId, input.productId)
        if (!productCheck.ok) {
          await rollbackTransaction(client)
          return reply.code(productCheck.statusCode).send({ message: productCheck.message })
        }

        const ingredientsCheck = await validateIngredients(
          client,
          organizationId,
          input.items.map((item) => item.ingredientProductId),
        )
        if (!ingredientsCheck.ok) {
          await rollbackTransaction(client)
          return reply.code(ingredientsCheck.statusCode).send({ message: ingredientsCheck.message })
        }

        const recipeResult = await client.query<{ id: string }>(
          `INSERT INTO recipes (
             organization_id,
             product_id,
             yield_quantity,
             notes,
             created_by,
             updated_by
           )
           VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING id`,
          [
            organizationId,
            input.productId,
            roundQuantity(input.yieldQuantity),
            normalizeOptionalText(input.notes),
            userId,
          ],
        )

        const recipeId = recipeResult.rows[0].id
        await replaceRecipeItems(client, organizationId, recipeId, input.items)
        await client.query('COMMIT')

        const recipe = await getRecipeById(client, organizationId, recipeId)
        return reply.code(201).send({ recipe })
      } catch (error) {
        await rollbackTransaction(client)
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: ACTIVE_RECIPE_EXISTS_MESSAGE, code: 'active_recipe_exists' })
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
      const { id } = recipeIdParamsSchema.parse(request.params)
      const input = updateRecipeSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const userId = request.organizationAccess!.user.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const currentResult = await client.query<{ id: string }>(
          `SELECT id
           FROM recipes
           WHERE organization_id = $1
             AND id = $2
           FOR UPDATE`,
          [organizationId, id],
        )

        if (!currentResult.rows[0]) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Receta no encontrada.' })
        }

        if (input.items) {
          const ingredientsCheck = await validateIngredients(
            client,
            organizationId,
            input.items.map((item) => item.ingredientProductId),
          )
          if (!ingredientsCheck.ok) {
            await rollbackTransaction(client)
            return reply.code(ingredientsCheck.statusCode).send({ message: ingredientsCheck.message })
          }

          await replaceRecipeItems(client, organizationId, id, input.items)
        }

        const assignments = ['updated_by = $3', 'updated_at = NOW()']
        const values: Array<string | number | null> = [organizationId, id, userId]

        if (input.yieldQuantity !== undefined) {
          values.push(roundQuantity(input.yieldQuantity))
          assignments.push(`yield_quantity = $${values.length}`)
        }

        if (input.notes !== undefined) {
          values.push(normalizeOptionalText(input.notes))
          assignments.push(`notes = $${values.length}`)
        }

        await client.query(
          `UPDATE recipes
           SET ${assignments.join(', ')}
           WHERE organization_id = $1
             AND id = $2`,
          values,
        )

        await client.query('COMMIT')

        const recipe = await getRecipeById(client, organizationId, id)
        return { recipe }
      } catch (error) {
        await rollbackTransaction(client)
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
      const { id } = recipeIdParamsSchema.parse(request.params)
      const input = updateRecipeStatusSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const userId = request.organizationAccess!.user.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const currentResult = await client.query<{ productId: string }>(
          `SELECT product_id AS "productId"
           FROM recipes
           WHERE organization_id = $1
             AND id = $2
           FOR UPDATE`,
          [organizationId, id],
        )

        const current = currentResult.rows[0]
        if (!current) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Receta no encontrada.' })
        }

        if (input.isActive) {
          const productCheck = await validateRecipeProduct(client, organizationId, current.productId)
          if (!productCheck.ok) {
            await rollbackTransaction(client)
            return reply.code(400).send({ message: productCheck.message })
          }
        }

        await client.query(
          `UPDATE recipes
           SET is_active = $3,
               updated_by = $4,
               updated_at = NOW()
           WHERE organization_id = $1
             AND id = $2`,
          [organizationId, id, input.isActive, userId],
        )

        await client.query('COMMIT')

        const recipe = await getRecipeById(client, organizationId, id)
        return { recipe }
      } catch (error) {
        await rollbackTransaction(client)
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: ACTIVE_RECIPE_EXISTS_MESSAGE, code: 'active_recipe_exists' })
        }
        throw error
      } finally {
        client.release()
      }
    },
  )
}
