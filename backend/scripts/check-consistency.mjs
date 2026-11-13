// Verifica invariantes del stock y la numeracion en TODA la base (o en una organizacion con
// CHECK_ORGANIZATION_ID). Solo lee, dentro de una transaccion REPEATABLE READ READ ONLY.
// Uso: npm run check:consistency
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import pg from 'pg'

const checks = [
  {
    name: 'saldo = suma de sus movimientos',
    sql: `SELECT ib.organization_id, ib.warehouse_id, ib.product_id, ib.quantity::text,
                 COALESCE(m.total, 0)::text AS movements_total
          FROM inventory_balances ib
          LEFT JOIN (
            SELECT warehouse_id, product_id, SUM(quantity_delta) AS total
            FROM inventory_movements
            GROUP BY warehouse_id, product_id
          ) m ON m.warehouse_id = ib.warehouse_id AND m.product_id = ib.product_id
          WHERE ($1::uuid IS NULL OR ib.organization_id = $1)
            AND ib.quantity <> COALESCE(m.total, 0)`,
  },
  {
    name: 'movimientos sin saldo (huerfanos de balance)',
    sql: `SELECT im.organization_id, im.warehouse_id, im.product_id, COUNT(*)::int AS movements
          FROM inventory_movements im
          LEFT JOIN inventory_balances ib
            ON ib.warehouse_id = im.warehouse_id AND ib.product_id = im.product_id
          WHERE ($1::uuid IS NULL OR im.organization_id = $1)
            AND ib.id IS NULL
          GROUP BY im.organization_id, im.warehouse_id, im.product_id`,
  },
  {
    name: 'movimientos sin documento de origen',
    sql: `SELECT im.id, im.source_type, im.source_id
          FROM inventory_movements im
          WHERE ($1::uuid IS NULL OR im.organization_id = $1)
            AND NOT CASE im.source_type
              WHEN 'purchase' THEN EXISTS (
                SELECT 1 FROM purchase_orders po
                WHERE po.id = im.source_id AND po.organization_id = im.organization_id)
              WHEN 'adjustment' THEN EXISTS (
                SELECT 1 FROM inventory_adjustments ia
                WHERE ia.id = im.source_id AND ia.organization_id = im.organization_id)
              WHEN 'order_delivery' THEN EXISTS (
                SELECT 1 FROM orders o
                WHERE o.id = im.source_id AND o.organization_id = im.organization_id AND o.status = 'delivered')
              WHEN 'waste' THEN EXISTS (
                SELECT 1 FROM waste_records wr
                WHERE wr.id = im.source_id AND wr.organization_id = im.organization_id)
              WHEN 'waste_void' THEN EXISTS (
                SELECT 1 FROM waste_records wr
                WHERE wr.id = im.source_id AND wr.organization_id = im.organization_id AND wr.status = 'voided')
              WHEN 'production_void' THEN EXISTS (
                SELECT 1 FROM production_runs pr
                WHERE pr.id = im.source_id AND pr.organization_id = im.organization_id AND pr.status = 'voided')
              ELSE EXISTS (
                SELECT 1 FROM production_runs pr
                WHERE pr.id = im.source_id AND pr.organization_id = im.organization_id)
            END`,
  },
  {
    name: 'reservado <= cantidad',
    sql: `SELECT organization_id, warehouse_id, product_id, quantity::text, reserved_quantity::text
          FROM inventory_balances
          WHERE ($1::uuid IS NULL OR organization_id = $1)
            AND reserved_quantity > quantity`,
  },
  {
    name: 'sin stock ni reserva negativos',
    sql: `SELECT organization_id, warehouse_id, product_id, quantity::text, reserved_quantity::text
          FROM inventory_balances
          WHERE ($1::uuid IS NULL OR organization_id = $1)
            AND (quantity < 0 OR reserved_quantity < 0)`,
  },
  {
    name: 'reservado = items de pedidos confirmados/en preparacion/listos',
    sql: `SELECT ib.organization_id, ib.warehouse_id, ib.product_id,
                 ib.reserved_quantity::text, COALESCE(r.total, 0)::text AS orders_total
          FROM inventory_balances ib
          LEFT JOIN (
            SELECT o.warehouse_id, oi.product_id, SUM(oi.quantity) AS total
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id AND oi.organization_id = o.organization_id
            WHERE o.status IN ('confirmed', 'preparing', 'ready')
              AND o.warehouse_id IS NOT NULL
            GROUP BY o.warehouse_id, oi.product_id
          ) r ON r.warehouse_id = ib.warehouse_id AND r.product_id = ib.product_id
          WHERE ($1::uuid IS NULL OR ib.organization_id = $1)
            AND ib.reserved_quantity <> COALESCE(r.total, 0)`,
  },
  {
    name: 'numeros PED- duplicados',
    sql: `SELECT organization_id, order_number, COUNT(*)::int AS repeated
          FROM orders
          WHERE ($1::uuid IS NULL OR organization_id = $1)
          GROUP BY organization_id, order_number
          HAVING COUNT(*) > 1`,
  },
  {
    name: 'numeros PROD- duplicados',
    sql: `SELECT organization_id, run_number, COUNT(*)::int AS repeated
          FROM production_runs
          WHERE ($1::uuid IS NULL OR organization_id = $1)
          GROUP BY organization_id, run_number
          HAVING COUNT(*) > 1`,
  },
  {
    name: 'numeros MER- duplicados',
    sql: `SELECT organization_id, waste_number, COUNT(*)::int AS repeated
          FROM waste_records
          WHERE ($1::uuid IS NULL OR organization_id = $1)
          GROUP BY organization_id, waste_number
          HAVING COUNT(*) > 1`,
  },
  {
    name: 'merma vigente con su salida y anulada con su devolucion',
    sql: `SELECT wr.organization_id, wr.waste_number, wr.status
          FROM waste_records wr
          WHERE ($1::uuid IS NULL OR wr.organization_id = $1)
            AND (
              NOT EXISTS (SELECT 1 FROM inventory_movements im
                          WHERE im.source_type = 'waste' AND im.source_id = wr.id AND im.quantity_delta = -wr.quantity)
              OR (wr.status = 'voided') <> EXISTS (
                          SELECT 1 FROM inventory_movements im
                          WHERE im.source_type = 'waste_void' AND im.source_id = wr.id AND im.quantity_delta = wr.quantity)
            )`,
  },
  {
    name: 'secuencia PED- detras del ultimo numero emitido',
    sql: `SELECT o.organization_id, MAX(SUBSTRING(o.order_number FROM 5)::int) AS max_number, s.last_number
          FROM orders o
          LEFT JOIN order_number_sequences s ON s.organization_id = o.organization_id
          WHERE ($1::uuid IS NULL OR o.organization_id = $1)
            AND o.order_number ~ '^PED-[0-9]+$'
          GROUP BY o.organization_id, s.last_number
          HAVING s.last_number IS NULL OR MAX(SUBSTRING(o.order_number FROM 5)::int) > s.last_number`,
  },
  {
    name: 'secuencia PROD- detras del ultimo numero emitido',
    sql: `SELECT pr.organization_id, MAX(SUBSTRING(pr.run_number FROM 6)::int) AS max_number, s.last_number
          FROM production_runs pr
          LEFT JOIN production_run_sequences s ON s.organization_id = pr.organization_id
          WHERE ($1::uuid IS NULL OR pr.organization_id = $1)
            AND pr.run_number ~ '^PROD-[0-9]+$'
          GROUP BY pr.organization_id, s.last_number
          HAVING s.last_number IS NULL OR MAX(SUBSTRING(pr.run_number FROM 6)::int) > s.last_number`,
  },
]

export async function runConsistencyChecks({ databaseUrl = process.env.DATABASE_URL, organizationId = null } = {}) {
  if (!databaseUrl) {
    throw new Error('Falta DATABASE_URL (backend/.env).')
  }

  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const results = []
    for (const check of checks) {
      const result = await client.query(check.sql, [organizationId])
      results.push({ name: check.name, failures: result.rowCount ?? 0, sample: result.rows.slice(0, 3) })
    }

    const scope = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM inventory_balances WHERE $1::uuid IS NULL OR organization_id = $1) AS balances,
         (SELECT COUNT(*)::int FROM inventory_movements WHERE $1::uuid IS NULL OR organization_id = $1) AS movements,
         (SELECT COUNT(*)::int FROM orders WHERE $1::uuid IS NULL OR organization_id = $1) AS orders,
         (SELECT COUNT(*)::int FROM production_runs WHERE $1::uuid IS NULL OR organization_id = $1) AS production_runs`,
      [organizationId],
    )
    await client.query('COMMIT')

    return { ok: results.every((result) => result.failures === 0), results, scope: scope.rows[0] }
  } finally {
    await client.end()
  }
}

export function printConsistency(report) {
  const { balances, movements, orders, production_runs: runs } = report.scope
  console.log(`Alcance: ${balances} saldos, ${movements} movimientos, ${orders} pedidos, ${runs} producciones`)
  for (const result of report.results) {
    console.log(`${result.failures === 0 ? 'OK  ' : 'FAIL'} ${result.name}${result.failures ? ` (${result.failures})` : ''}`)
    if (result.failures) console.log(`      ej.: ${JSON.stringify(result.sample)}`)
  }
  console.log(report.ok ? '\nConsistencia: OK' : '\nConsistencia: FALLA')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runConsistencyChecks({ organizationId: process.env.CHECK_ORGANIZATION_ID || null })
  printConsistency(report)
  process.exitCode = report.ok ? 0 : 1
}
