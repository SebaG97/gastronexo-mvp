import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'
import { lockBalances, recordMovement, type LockedBalance } from '../inventory/stock-ledger.js'

type DbClient = Pick<typeof pool, 'query'>

const productionRunIdParamsSchema = z.object({
  id: z.string().uuid(),
})

const listProductionRunsQuerySchema = z.object({
  status: z.enum(['completed', 'voided', 'all']).default('all'),
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const productionInputSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.coerce.number().positive().max(99_999_999),
})

const createProductionRunSchema = productionInputSchema.extend({
  notes: z.string().trim().max(600).nullable().optional(),
})

const voidProductionRunSchema = z.object({
  reason: z.string().trim().max(300).nullable().optional(),
})

type ProductionInput = z.infer<typeof productionInputSchema>

type PlanFailure = { ok: false; statusCode: number; message: string; code: string }

type PlannedIngredient = {
  productId: string
  productName: string
  unit: string
  recipeQuantity: number
  required: number
  available: number
  missing: number
  unitCost: number
  subtotal: number
}

type ProductionPlan = {
  ok: true
  product: { id: string; name: string; unit: string; cost: number }
  recipe: { id: string; yieldQuantity: number }
  warehouse: { id: string; name: string }
  quantity: number
  ingredients: PlannedIngredient[]
  totalCost: number
  unitCost: number
  currentStock: number
  resultingCost: number
  balances: Map<string, LockedBalance>
}

function roundQuantity(value: number) {
  return Number(value.toFixed(3))
}

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

async function rollbackTransaction(client: DbClient) {
  try {
    await client.query('ROLLBACK')
  } catch {
    return
  }
}

async function getNextRunNumber(client: DbClient, organizationId: string) {
  const result = await client.query<{ nextNumber: number }>(
    `INSERT INTO production_run_sequences (organization_id, last_number)
     VALUES ($1, 1)
     ON CONFLICT (organization_id)
     DO UPDATE SET last_number = production_run_sequences.last_number + 1
     RETURNING last_number AS "nextNumber"`,
    [organizationId],
  )

  return `PROD-${String(result.rows[0].nextNumber).padStart(6, '0')}`
}

/** Stock total del producto en todos los depositos: base del costo promedio (igual que Compras). */
async function getGlobalQuantity(client: DbClient, organizationId: string, productId: string) {
  const result = await client.query<{ totalQuantity: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::text AS "totalQuantity"
     FROM inventory_balances
     WHERE organization_id = $1
       AND product_id = $2`,
    [organizationId, productId],
  )

  return Number(result.rows[0]?.totalQuantity ?? '0')
}

/**
 * Calcula consumo, disponibilidad y costo de producir `quantity` del producto con su receta
 * activa. Con `lock`, bloquea (FOR UPDATE) los balances de ingredientes y terminado y la fila
 * del producto terminado: es la misma funcion que usa el registro real, asi la vista previa
 * y la produccion no pueden divergir.
 */
async function planProduction(
  client: DbClient,
  organizationId: string,
  input: ProductionInput,
  options: { lock: boolean },
): Promise<ProductionPlan | PlanFailure> {
  const productResult = await client.query<{
    id: string
    name: string
    unit: string
    isActive: boolean
    productType: string
  }>(
    `SELECT id, name, unit, is_active AS "isActive", product_type AS "productType"
     FROM products
     WHERE organization_id = $1
       AND id = $2
     LIMIT 1`,
    [organizationId, input.productId],
  )

  const product = productResult.rows[0]
  if (!product) {
    return { ok: false, statusCode: 404, message: 'Producto no encontrado.', code: 'not_found' }
  }

  if (product.productType !== 'finished_product' || !product.isActive) {
    return {
      ok: false,
      statusCode: 400,
      message: 'Solo se pueden producir productos terminados activos.',
      code: 'invalid_product',
    }
  }

  const warehouseResult = await client.query<{ id: string; name: string; isActive: boolean }>(
    `SELECT id, name, is_active AS "isActive"
     FROM warehouses
     WHERE organization_id = $1
       AND id = $2
     LIMIT 1`,
    [organizationId, input.warehouseId],
  )

  const warehouse = warehouseResult.rows[0]
  if (!warehouse) {
    return { ok: false, statusCode: 404, message: 'Depósito no encontrado.', code: 'not_found' }
  }

  if (!warehouse.isActive) {
    return {
      ok: false,
      statusCode: 400,
      message: 'No se puede producir en un depósito inactivo.',
      code: 'inactive_warehouse',
    }
  }

  const recipeResult = await client.query<{ id: string; yieldQuantity: string }>(
    `SELECT id, yield_quantity::text AS "yieldQuantity"
     FROM recipes
     WHERE organization_id = $1
       AND product_id = $2
       AND is_active = TRUE
     LIMIT 1`,
    [organizationId, input.productId],
  )

  const recipe = recipeResult.rows[0]
  if (!recipe) {
    return {
      ok: false,
      statusCode: 400,
      message: 'El producto no tiene una receta activa.',
      code: 'recipe_required',
    }
  }

  const itemsResult = await client.query<{
    productId: string
    productName: string
    unit: string
    isActive: boolean
    productType: string
    cost: string
    quantity: string
  }>(
    `SELECT
       p.id AS "productId",
       p.name AS "productName",
       p.unit,
       p.is_active AS "isActive",
       p.product_type AS "productType",
       p.cost::text AS cost,
       ri.quantity::text AS quantity
     FROM recipe_items ri
     JOIN products p
       ON p.id = ri.ingredient_product_id
      AND p.organization_id = ri.organization_id
     WHERE ri.organization_id = $1
       AND ri.recipe_id = $2
     ORDER BY p.name ASC`,
    [organizationId, recipe.id],
  )

  // Un ingrediente pudo cambiar de tipo o inactivarse despues de cargar la receta.
  if (
    itemsResult.rows.length === 0 ||
    itemsResult.rows.some((item) => item.productType !== 'raw_material' || !item.isActive)
  ) {
    return {
      ok: false,
      statusCode: 400,
      message: 'La receta tiene ingredientes que ya no son materias primas activas. Editala antes de producir.',
      code: 'invalid_recipe',
    }
  }

  const yieldQuantity = Number(recipe.yieldQuantity)
  const quantity = roundQuantity(input.quantity)
  const factor = quantity / yieldQuantity

  const productIds = [...itemsResult.rows.map((item) => item.productId), product.id]

  if (options.lock) {
    // El balance del terminado debe existir antes de bloquear: si una transaccion concurrente
    // lo crea a mitad de camino, las demas lo bloquearian en otro orden (deadlock).
    await client.query(
      `INSERT INTO inventory_balances (organization_id, warehouse_id, product_id, quantity)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (warehouse_id, product_id) DO NOTHING`,
      [organizationId, input.warehouseId, product.id],
    )
  }

  const balances = options.lock
    ? await lockBalances(client, organizationId, input.warehouseId, productIds)
    : await readBalances(client, organizationId, input.warehouseId, productIds)

  const ingredients: PlannedIngredient[] = []
  for (const item of itemsResult.rows) {
    const required = roundQuantity(Number(item.quantity) * factor)
    if (required <= 0) {
      return {
        ok: false,
        statusCode: 400,
        message: `La cantidad a producir es demasiado chica: ${item.productName} quedaría en 0.`,
        code: 'quantity_too_small',
      }
    }

    const balance = balances.get(item.productId)
    const available = balance ? roundQuantity(balance.quantity - balance.reservedQuantity) : 0
    const unitCost = Number(item.cost)

    ingredients.push({
      productId: item.productId,
      productName: item.productName,
      unit: item.unit,
      recipeQuantity: Number(item.quantity),
      required,
      available,
      missing: available >= required ? 0 : roundQuantity(required - available),
      unitCost,
      subtotal: roundMoney(required * unitCost),
    })
  }

  const totalCost = roundMoney(ingredients.reduce((total, item) => total + item.subtotal, 0))
  const unitCost = Number((totalCost / quantity).toFixed(4))

  const costResult = await client.query<{ cost: string }>(
    `SELECT cost::text AS cost
     FROM products
     WHERE organization_id = $1
       AND id = $2
     ${options.lock ? 'FOR UPDATE' : ''}`,
    [organizationId, product.id],
  )
  const currentCost = Number(costResult.rows[0]?.cost ?? '0')
  const currentStock = await getGlobalQuantity(client, organizationId, product.id)
  const resultingCost = roundMoney((currentStock * currentCost + totalCost) / (currentStock + quantity))

  return {
    ok: true,
    product: { id: product.id, name: product.name, unit: product.unit, cost: currentCost },
    recipe: { id: recipe.id, yieldQuantity },
    warehouse: { id: warehouse.id, name: warehouse.name },
    quantity,
    ingredients,
    totalCost,
    unitCost,
    currentStock,
    resultingCost,
    balances,
  }
}

async function readBalances(client: DbClient, organizationId: string, warehouseId: string, productIds: string[]) {
  const result = await client.query<{ productId: string; quantity: string; reservedQuantity: string }>(
    `SELECT
       product_id AS "productId",
       quantity::text AS quantity,
       reserved_quantity::text AS "reservedQuantity"
     FROM inventory_balances
     WHERE organization_id = $1
       AND warehouse_id = $2
       AND product_id = ANY($3::uuid[])`,
    [organizationId, warehouseId, productIds],
  )

  return new Map<string, LockedBalance>(
    result.rows.map((row) => [
      row.productId,
      { productId: row.productId, quantity: Number(row.quantity), reservedQuantity: Number(row.reservedQuantity) },
    ]),
  )
}

function toShortages(plan: ProductionPlan) {
  return plan.ingredients
    .filter((item) => item.missing > 0)
    .map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unit: item.unit,
      requested: item.required.toFixed(3),
      available: item.available.toFixed(3),
      missing: item.missing.toFixed(3),
    }))
}

function serializePlan(plan: ProductionPlan) {
  const shortages = toShortages(plan)

  return {
    productId: plan.product.id,
    productName: plan.product.name,
    productUnit: plan.product.unit,
    recipeId: plan.recipe.id,
    recipeYieldQuantity: plan.recipe.yieldQuantity.toFixed(3),
    warehouseId: plan.warehouse.id,
    warehouseName: plan.warehouse.name,
    quantity: plan.quantity.toFixed(3),
    ingredients: plan.ingredients.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unit: item.unit,
      recipeQuantity: item.recipeQuantity.toFixed(3),
      required: item.required.toFixed(3),
      available: item.available.toFixed(3),
      missing: item.missing.toFixed(3),
      isSufficient: item.missing === 0,
      unitCost: item.unitCost.toFixed(2),
      subtotal: item.subtotal.toFixed(2),
    })),
    totalCost: plan.totalCost.toFixed(2),
    unitCost: plan.unitCost.toFixed(4),
    currentCost: plan.product.cost.toFixed(2),
    currentStock: plan.currentStock.toFixed(3),
    resultingCost: plan.resultingCost.toFixed(2),
    canProduce: shortages.length === 0,
    shortages,
  }
}

const productionRunSelectSql = `
  SELECT
    pr.id,
    pr.run_number AS "runNumber",
    pr.product_id AS "productId",
    pr.product_name_snapshot AS "productName",
    pr.product_unit_snapshot AS "productUnit",
    pr.recipe_id AS "recipeId",
    pr.recipe_yield_snapshot::text AS "recipeYieldQuantity",
    pr.warehouse_id AS "warehouseId",
    w.name AS "warehouseName",
    pr.quantity_produced::text AS "quantityProduced",
    pr.unit_cost::text AS "unitCost",
    pr.total_cost::text AS "totalCost",
    pr.status,
    pr.notes,
    pr.created_by AS "createdBy",
    cu.full_name AS "createdByUserName",
    pr.created_at AS "createdAt",
    pr.voided_at AS "voidedAt",
    vu.full_name AS "voidedByUserName",
    pr.void_reason AS "voidReason"
  FROM production_runs pr
  JOIN warehouses w
    ON w.id = pr.warehouse_id
   AND w.organization_id = pr.organization_id
  JOIN users cu ON cu.id = pr.created_by
  LEFT JOIN users vu ON vu.id = pr.voided_by`

async function getProductionRunById(client: DbClient, organizationId: string, runId: string) {
  const runResult = await client.query(
    `${productionRunSelectSql}
     WHERE pr.organization_id = $1
       AND pr.id = $2
     LIMIT 1`,
    [organizationId, runId],
  )

  const run = runResult.rows[0]
  if (!run) {
    return null
  }

  const itemsResult = await client.query(
    `SELECT
       id,
       product_id AS "productId",
       product_name_snapshot AS "productName",
       product_unit_snapshot AS unit,
       quantity::text AS quantity,
       unit_cost::text AS "unitCost",
       subtotal::text AS subtotal
     FROM production_run_items
     WHERE organization_id = $1
       AND production_run_id = $2
     ORDER BY product_name_snapshot ASC`,
    [organizationId, runId],
  )

  return { ...run, items: itemsResult.rows }
}

export const productionRunsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request, reply) => {
      const query = listProductionRunsQuerySchema.parse(request.query)
      const organizationId = request.organizationAccess!.organization.id

      const whereClauses = ['pr.organization_id = $1']
      const params: Array<string | number | Date> = [organizationId]

      if (query.productId) {
        const productResult = await pool.query(
          'SELECT id FROM products WHERE organization_id = $1 AND id = $2 LIMIT 1',
          [organizationId, query.productId],
        )
        if (!productResult.rows[0]) {
          return reply.code(404).send({ message: 'Producto no encontrado.' })
        }

        params.push(query.productId)
        whereClauses.push(`pr.product_id = $${params.length}`)
      }

      if (query.warehouseId) {
        const warehouseResult = await pool.query(
          'SELECT id FROM warehouses WHERE organization_id = $1 AND id = $2 LIMIT 1',
          [organizationId, query.warehouseId],
        )
        if (!warehouseResult.rows[0]) {
          return reply.code(404).send({ message: 'Depósito no encontrado.' })
        }

        params.push(query.warehouseId)
        whereClauses.push(`pr.warehouse_id = $${params.length}`)
      }

      if (query.status !== 'all') {
        params.push(query.status)
        whereClauses.push(`pr.status = $${params.length}`)
      }

      if (query.from) {
        params.push(query.from)
        whereClauses.push(`pr.created_at >= $${params.length}`)
      }

      if (query.to) {
        params.push(query.to)
        whereClauses.push(`pr.created_at <= $${params.length}`)
      }

      if (query.q) {
        params.push(`%${query.q}%`)
        whereClauses.push(
          `(pr.run_number ILIKE $${params.length} OR pr.product_name_snapshot ILIKE $${params.length})`,
        )
      }

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`

      const totalResult = await pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM production_runs pr
         ${whereSql}`,
        params,
      )

      const total = Number(totalResult.rows[0]?.total ?? 0)
      const listParams = [...params, query.pageSize, (query.page - 1) * query.pageSize]

      const result = await pool.query(
        `${productionRunSelectSql}
         ${whereSql}
         ORDER BY pr.created_at DESC, pr.run_number DESC
         LIMIT $${listParams.length - 1}
         OFFSET $${listParams.length}`,
        listParams,
      )

      return {
        productionRuns: result.rows,
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
      const { id } = productionRunIdParamsSchema.parse(request.params)
      const organizationId = request.organizationAccess!.organization.id

      const productionRun = await getProductionRunById(pool, organizationId, id)
      if (!productionRun) {
        return reply.code(404).send({ message: 'Producción no encontrada.' })
      }

      return { productionRun }
    },
  )

  // Vista previa: misma logica que el registro real, sin escribir nada.
  app.post(
    '/preview',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request, reply) => {
      const input = productionInputSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      const plan = await planProduction(pool, organizationId, input, { lock: false })
      if (!plan.ok) {
        return reply.code(plan.statusCode).send({ message: plan.message, code: plan.code })
      }

      return { preview: serializePlan(plan) }
    },
  )

  app.post(
    '/',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const input = createProductionRunSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const userId = request.organizationAccess!.user.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const plan = await planProduction(client, organizationId, input, { lock: true })
        if (!plan.ok) {
          await rollbackTransaction(client)
          return reply.code(plan.statusCode).send({ message: plan.message, code: plan.code })
        }

        const shortages = toShortages(plan)
        if (shortages.length > 0) {
          await rollbackTransaction(client)
          return reply.code(409).send({
            message: `Materia prima insuficiente en ${plan.warehouse.name}.`,
            code: 'insufficient_stock',
            warehouseId: plan.warehouse.id,
            warehouseName: plan.warehouse.name,
            shortages,
          })
        }

        const runNumber = await getNextRunNumber(client, organizationId)
        const runResult = await client.query<{ id: string }>(
          `INSERT INTO production_runs (
             organization_id,
             run_number,
             product_id,
             recipe_id,
             warehouse_id,
             quantity_produced,
             unit_cost,
             total_cost,
             product_name_snapshot,
             product_unit_snapshot,
             recipe_yield_snapshot,
             notes,
             created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id`,
          [
            organizationId,
            runNumber,
            plan.product.id,
            plan.recipe.id,
            plan.warehouse.id,
            plan.quantity,
            plan.unitCost,
            plan.totalCost,
            plan.product.name,
            plan.product.unit,
            plan.recipe.yieldQuantity,
            normalizeOptionalText(input.notes),
            userId,
          ],
        )
        const runId = runResult.rows[0].id

        // Consumo de materia prima: el disponible ya se valido con los balances bloqueados.
        for (const ingredient of plan.ingredients) {
          const balance = plan.balances.get(ingredient.productId)!
          const balanceAfter = roundQuantity(balance.quantity - ingredient.required)

          await client.query(
            `UPDATE inventory_balances
             SET quantity = quantity - $4,
                 updated_at = NOW()
             WHERE organization_id = $1
               AND warehouse_id = $2
               AND product_id = $3`,
            [organizationId, plan.warehouse.id, ingredient.productId, ingredient.required],
          )

          await recordMovement(client, {
            organizationId,
            warehouseId: plan.warehouse.id,
            productId: ingredient.productId,
            movementType: 'production',
            quantityDelta: -ingredient.required,
            balanceAfter,
            sourceType: 'production_consumption',
            sourceId: runId,
            createdBy: userId,
          })

          await client.query(
            `INSERT INTO production_run_items (
               production_run_id,
               organization_id,
               product_id,
               product_name_snapshot,
               product_unit_snapshot,
               quantity,
               unit_cost,
               subtotal
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              runId,
              organizationId,
              ingredient.productId,
              ingredient.productName,
              ingredient.unit,
              ingredient.required,
              ingredient.unitCost,
              ingredient.subtotal,
            ],
          )
        }

        // Salida de terminado.
        const outputResult = await client.query<{ quantity: string }>(
          `INSERT INTO inventory_balances (organization_id, warehouse_id, product_id, quantity)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (warehouse_id, product_id)
           DO UPDATE SET
             quantity = inventory_balances.quantity + EXCLUDED.quantity,
             updated_at = NOW()
           RETURNING quantity::text AS quantity`,
          [organizationId, plan.warehouse.id, plan.product.id, plan.quantity],
        )

        await recordMovement(client, {
          organizationId,
          warehouseId: plan.warehouse.id,
          productId: plan.product.id,
          movementType: 'production',
          quantityDelta: plan.quantity,
          balanceAfter: Number(outputResult.rows[0].quantity),
          sourceType: 'production_output',
          sourceId: runId,
          createdBy: userId,
        })

        await client.query(
          `UPDATE products
           SET cost = $3,
               updated_at = NOW()
           WHERE organization_id = $1
             AND id = $2`,
          [organizationId, plan.product.id, plan.resultingCost],
        )

        await client.query('COMMIT')

        const productionRun = await getProductionRunById(client, organizationId, runId)
        return reply.code(201).send({
          productionRun,
          resultingCost: plan.resultingCost.toFixed(2),
        })
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )

  /**
   * Anular: el ledger es inmutable, asi que se escriben movimientos inversos (`production_void`).
   * Solo si el terminado producido sigue disponible (no reservado ni vendido) en el deposito.
   */
  app.post(
    '/:id/void',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator') },
    async (request, reply) => {
      const { id } = productionRunIdParamsSchema.parse(request.params)
      const input = voidProductionRunSchema.parse(request.body ?? {})
      const organizationId = request.organizationAccess!.organization.id
      const userId = request.organizationAccess!.user.id
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const runResult = await client.query<{
          productId: string
          productName: string
          productUnit: string
          warehouseId: string
          quantityProduced: string
          totalCost: string
          status: 'completed' | 'voided'
          runNumber: string
        }>(
          `SELECT
             product_id AS "productId",
             product_name_snapshot AS "productName",
             product_unit_snapshot AS "productUnit",
             warehouse_id AS "warehouseId",
             quantity_produced::text AS "quantityProduced",
             total_cost::text AS "totalCost",
             status,
             run_number AS "runNumber"
           FROM production_runs
           WHERE organization_id = $1
             AND id = $2
           FOR UPDATE`,
          [organizationId, id],
        )

        const run = runResult.rows[0]
        if (!run) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: 'Producción no encontrada.' })
        }

        if (run.status === 'voided') {
          await rollbackTransaction(client)
          return reply.code(409).send({ message: `${run.runNumber} ya está anulada.`, code: 'already_voided' })
        }

        const itemsResult = await client.query<{ productId: string; quantity: string; subtotal: string }>(
          `SELECT product_id AS "productId", quantity::text AS quantity, subtotal::text AS subtotal
           FROM production_run_items
           WHERE organization_id = $1
             AND production_run_id = $2`,
          [organizationId, id],
        )

        const quantityProduced = Number(run.quantityProduced)
        const balances = await lockBalances(client, organizationId, run.warehouseId, [
          ...itemsResult.rows.map((item) => item.productId),
          run.productId,
        ])

        const outputBalance = balances.get(run.productId)
        const outputAvailable = outputBalance
          ? roundQuantity(outputBalance.quantity - outputBalance.reservedQuantity)
          : 0

        if (!outputBalance || outputAvailable < quantityProduced) {
          await rollbackTransaction(client)
          return reply.code(409).send({
            message: `No se puede anular ${run.runNumber}: de ${run.productName} hay ${outputAvailable.toFixed(3)} disponibles y la producción sumó ${quantityProduced.toFixed(3)} (el resto está reservado o vendido).`,
            code: 'output_not_available',
            productName: run.productName,
            unit: run.productUnit,
            required: quantityProduced.toFixed(3),
            available: outputAvailable.toFixed(3),
          })
        }

        // Producto row locks en orden fijo, despues de los balances (mismo orden que producir).
        const affectedProductIds = [run.productId, ...itemsResult.rows.map((item) => item.productId)].sort()
        const costsResult = await client.query<{ id: string; cost: string }>(
          `SELECT id, cost::text AS cost
           FROM products
           WHERE organization_id = $1
             AND id = ANY($2::uuid[])
           ORDER BY id
           FOR UPDATE`,
          [organizationId, affectedProductIds],
        )
        const costsById = new Map(costsResult.rows.map((row) => [row.id, Number(row.cost)]))

        // Quitar el terminado y revertir su costo promedio (piso 0).
        const outputBalanceAfter = roundQuantity(outputBalance.quantity - quantityProduced)
        await client.query(
          `UPDATE inventory_balances
           SET quantity = quantity - $4,
               updated_at = NOW()
           WHERE organization_id = $1
             AND warehouse_id = $2
             AND product_id = $3`,
          [organizationId, run.warehouseId, run.productId, quantityProduced],
        )
        await recordMovement(client, {
          organizationId,
          warehouseId: run.warehouseId,
          productId: run.productId,
          movementType: 'production',
          quantityDelta: -quantityProduced,
          balanceAfter: outputBalanceAfter,
          sourceType: 'production_void',
          sourceId: id,
          createdBy: userId,
        })

        const outputGlobalAfter = await getGlobalQuantity(client, organizationId, run.productId)
        const outputCost = costsById.get(run.productId) ?? 0
        const outputGlobalBefore = roundQuantity(outputGlobalAfter + quantityProduced)
        const outputNewCost =
          outputGlobalAfter > 0
            ? Math.max(0, roundMoney((outputGlobalBefore * outputCost - Number(run.totalCost)) / outputGlobalAfter))
            : outputCost
        await client.query(
          'UPDATE products SET cost = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2',
          [organizationId, run.productId, outputNewCost],
        )

        // Devolver materia prima al costo del snapshot (entra como una compra a ese costo).
        for (const item of itemsResult.rows) {
          const quantity = Number(item.quantity)
          const returnResult = await client.query<{ quantity: string }>(
            `INSERT INTO inventory_balances (organization_id, warehouse_id, product_id, quantity)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (warehouse_id, product_id)
             DO UPDATE SET
               quantity = inventory_balances.quantity + EXCLUDED.quantity,
               updated_at = NOW()
             RETURNING quantity::text AS quantity`,
            [organizationId, run.warehouseId, item.productId, quantity],
          )

          await recordMovement(client, {
            organizationId,
            warehouseId: run.warehouseId,
            productId: item.productId,
            movementType: 'production',
            quantityDelta: quantity,
            balanceAfter: Number(returnResult.rows[0].quantity),
            sourceType: 'production_void',
            sourceId: id,
            createdBy: userId,
          })

          const globalAfter = await getGlobalQuantity(client, organizationId, item.productId)
          const globalBefore = roundQuantity(globalAfter - quantity)
          const previousCost = costsById.get(item.productId) ?? 0
          const newCost =
            globalAfter > 0
              ? roundMoney((globalBefore * previousCost + Number(item.subtotal)) / globalAfter)
              : previousCost
          await client.query(
            'UPDATE products SET cost = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2',
            [organizationId, item.productId, newCost],
          )
        }

        await client.query(
          `UPDATE production_runs
           SET status = 'voided',
               voided_by = $3,
               voided_at = NOW(),
               void_reason = $4,
               updated_at = NOW()
           WHERE organization_id = $1
             AND id = $2`,
          [organizationId, id, userId, normalizeOptionalText(input.reason)],
        )

        await client.query('COMMIT')

        const productionRun = await getProductionRunById(client, organizationId, id)
        return { productionRun }
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )
}
