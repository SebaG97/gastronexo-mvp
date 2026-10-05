import type { pool } from '../../db/pool.js'

type DbClient = Pick<typeof pool, 'query'>

export type MovementType = 'purchase' | 'adjustment' | 'sale'
export type MovementSourceType = 'purchase' | 'adjustment' | 'order_delivery'

export type StockRequirement = {
  productId: string
  quantity: number
}

export type LockedBalance = {
  productId: string
  quantity: number
  reservedQuantity: number
}

export type StockShortage = {
  productId: string
  productName: string
  unit: string
  requested: string
  available: string
  missing: string
}

function roundQuantity(value: number) {
  return Number(value.toFixed(3))
}

/** Suma cantidades por producto (un pedido puede tener el mismo producto con distintos cortes). */
export function aggregateByProduct(items: Array<{ productId: string; quantity: number | string }>) {
  const totals = new Map<string, number>()
  for (const item of items) {
    totals.set(item.productId, roundQuantity((totals.get(item.productId) ?? 0) + Number(item.quantity)))
  }

  return [...totals.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId))
}

/**
 * Bloquea (FOR UPDATE) los balances de los productos en el deposito, siempre en el mismo
 * orden para que dos transacciones concurrentes no se bloqueen mutuamente.
 */
export async function lockBalances(
  client: DbClient,
  organizationId: string,
  warehouseId: string,
  productIds: string[],
) {
  const result = await client.query<{ productId: string; quantity: string; reservedQuantity: string }>(
    `SELECT
       product_id AS "productId",
       quantity::text AS quantity,
       reserved_quantity::text AS "reservedQuantity"
     FROM inventory_balances
     WHERE organization_id = $1
       AND warehouse_id = $2
       AND product_id = ANY($3::uuid[])
     ORDER BY product_id
     FOR UPDATE`,
    [organizationId, warehouseId, productIds],
  )

  return new Map<string, LockedBalance>(
    result.rows.map((row) => [
      row.productId,
      { productId: row.productId, quantity: Number(row.quantity), reservedQuantity: Number(row.reservedQuantity) },
    ]),
  )
}

async function describeShortages(
  client: DbClient,
  organizationId: string,
  shortages: Array<{ productId: string; requested: number; available: number }>,
): Promise<StockShortage[]> {
  const productsResult = await client.query<{ id: string; name: string; unit: string }>(
    `SELECT id, name, unit
     FROM products
     WHERE organization_id = $1
       AND id = ANY($2::uuid[])`,
    [organizationId, shortages.map((shortage) => shortage.productId)],
  )
  const productsById = new Map(productsResult.rows.map((product) => [product.id, product]))

  return shortages.map((shortage) => {
    const product = productsById.get(shortage.productId)
    return {
      productId: shortage.productId,
      productName: product?.name ?? 'Producto',
      unit: product?.unit ?? 'unit',
      requested: shortage.requested.toFixed(3),
      available: shortage.available.toFixed(3),
      missing: roundQuantity(shortage.requested - shortage.available).toFixed(3),
    }
  })
}

/**
 * Reserva stock para todos los requerimientos o para ninguno. Los balances deben estar
 * bloqueados por la transaccion actual (ver lockBalances).
 */
export async function reserveStock(
  client: DbClient,
  organizationId: string,
  warehouseId: string,
  requirements: StockRequirement[],
  balances: Map<string, LockedBalance>,
) {
  const shortages: Array<{ productId: string; requested: number; available: number }> = []

  for (const requirement of requirements) {
    const balance = balances.get(requirement.productId)
    const available = balance ? roundQuantity(balance.quantity - balance.reservedQuantity) : 0
    if (available < requirement.quantity) {
      shortages.push({ productId: requirement.productId, requested: requirement.quantity, available })
    }
  }

  if (shortages.length > 0) {
    return { ok: false as const, shortages: await describeShortages(client, organizationId, shortages) }
  }

  for (const requirement of requirements) {
    await client.query(
      `UPDATE inventory_balances
       SET reserved_quantity = reserved_quantity + $4,
           updated_at = NOW()
       WHERE organization_id = $1
         AND warehouse_id = $2
         AND product_id = $3`,
      [organizationId, warehouseId, requirement.productId, requirement.quantity],
    )

    const balance = balances.get(requirement.productId)!
    balance.reservedQuantity = roundQuantity(balance.reservedQuantity + requirement.quantity)
  }

  return { ok: true as const }
}

/** Libera una reserva previa. Falla (CHECK) si la reserva registrada es menor: no se tapa una inconsistencia. */
export async function releaseStock(
  client: DbClient,
  organizationId: string,
  warehouseId: string,
  requirements: StockRequirement[],
  balances: Map<string, LockedBalance>,
) {
  for (const requirement of requirements) {
    await client.query(
      `UPDATE inventory_balances
       SET reserved_quantity = reserved_quantity - $4,
           updated_at = NOW()
       WHERE organization_id = $1
         AND warehouse_id = $2
         AND product_id = $3`,
      [organizationId, warehouseId, requirement.productId, requirement.quantity],
    )

    const balance = balances.get(requirement.productId)
    if (balance) {
      balance.reservedQuantity = roundQuantity(balance.reservedQuantity - requirement.quantity)
    }
  }
}

export async function recordMovement(
  client: DbClient,
  movement: {
    organizationId: string
    warehouseId: string
    productId: string
    movementType: MovementType
    quantityDelta: number
    balanceAfter: number
    sourceType: MovementSourceType
    sourceId: string
    createdBy: string
  },
) {
  await client.query(
    `INSERT INTO inventory_movements (
       organization_id,
       warehouse_id,
       product_id,
       movement_type,
       quantity_delta,
       balance_after,
       source_type,
       source_id,
       created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      movement.organizationId,
      movement.warehouseId,
      movement.productId,
      movement.movementType,
      roundQuantity(movement.quantityDelta),
      roundQuantity(movement.balanceAfter),
      movement.sourceType,
      movement.sourceId,
      movement.createdBy,
    ],
  )
}

/**
 * Consume la reserva de un pedido entregado: baja quantity y reserved_quantity y escribe
 * un movimiento `sale` por producto con su balance_after.
 */
export async function consumeReservedStock(
  client: DbClient,
  params: {
    organizationId: string
    warehouseId: string
    orderId: string
    userId: string
    requirements: StockRequirement[]
    balances: Map<string, LockedBalance>
  },
) {
  for (const requirement of params.requirements) {
    const balance = params.balances.get(requirement.productId)
    if (!balance || balance.reservedQuantity < requirement.quantity || balance.quantity < requirement.quantity) {
      return { ok: false as const, productId: requirement.productId }
    }

    const balanceAfter = roundQuantity(balance.quantity - requirement.quantity)
    await client.query(
      `UPDATE inventory_balances
       SET quantity = quantity - $4,
           reserved_quantity = reserved_quantity - $4,
           updated_at = NOW()
       WHERE organization_id = $1
         AND warehouse_id = $2
         AND product_id = $3`,
      [params.organizationId, params.warehouseId, requirement.productId, requirement.quantity],
    )

    await recordMovement(client, {
      organizationId: params.organizationId,
      warehouseId: params.warehouseId,
      productId: requirement.productId,
      movementType: 'sale',
      quantityDelta: -requirement.quantity,
      balanceAfter,
      sourceType: 'order_delivery',
      sourceId: params.orderId,
      createdBy: params.userId,
    })

    balance.quantity = balanceAfter
    balance.reservedQuantity = roundQuantity(balance.reservedQuantity - requirement.quantity)
  }

  return { ok: true as const }
}
