-- Mision 6.1: ledger inmutable de movimientos, reservas por pedido y deposito del pedido.
-- Idempotente: puede re-ejecutarse sobre una base que ya la tenga aplicada.

CREATE UNIQUE INDEX IF NOT EXISTS warehouses_id_organization_id_unique
  ON warehouses (id, organization_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL,
  product_id UUID NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'adjustment', 'sale')),
  quantity_delta NUMERIC(14, 3) NOT NULL,
  balance_after NUMERIC(14, 3) NOT NULL CHECK (balance_after >= 0),
  source_type TEXT NOT NULL CHECK (source_type IN ('purchase', 'adjustment', 'order_delivery')),
  source_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_movements_warehouse_org_fk
    FOREIGN KEY (warehouse_id, organization_id)
    REFERENCES warehouses (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT inventory_movements_product_org_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES products (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT inventory_movements_delta_sign CHECK (
    (movement_type = 'purchase' AND quantity_delta > 0)
    OR (movement_type = 'sale' AND quantity_delta < 0)
    OR movement_type = 'adjustment'
  ),
  CONSTRAINT inventory_movements_type_matches_source CHECK (
    (movement_type = 'purchase' AND source_type = 'purchase')
    OR (movement_type = 'adjustment' AND source_type = 'adjustment')
    OR (movement_type = 'sale' AND source_type = 'order_delivery')
  )
);

-- Un mismo origen no puede mover dos veces el mismo producto en el mismo deposito:
-- vuelve idempotente el backfill y evita descontar dos veces una entrega.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_source_unique
  ON inventory_movements (source_type, source_id, warehouse_id, product_id);

CREATE INDEX IF NOT EXISTS inventory_movements_org_created_at_idx
  ON inventory_movements (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_warehouse_product_idx
  ON inventory_movements (warehouse_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_product_idx
  ON inventory_movements (product_id);

-- Inmutabilidad: las correcciones se registran como movimientos nuevos.
CREATE OR REPLACE FUNCTION inventory_movements_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movements es inmutable: % no permitido', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS inventory_movements_no_update_delete ON inventory_movements;
CREATE TRIGGER inventory_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION inventory_movements_reject_mutation();

DROP TRIGGER IF EXISTS inventory_movements_no_truncate ON inventory_movements;
CREATE TRIGGER inventory_movements_no_truncate
  BEFORE TRUNCATE ON inventory_movements
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_movements_reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON inventory_movements FROM PUBLIC;

-- Backfill desde inventory_adjustments (ajustes manuales y entradas por compra).
-- balance_after = new_quantity, que ya es el saldo posterior registrado en 003/004.
INSERT INTO inventory_movements (
  organization_id,
  warehouse_id,
  product_id,
  movement_type,
  quantity_delta,
  balance_after,
  source_type,
  source_id,
  created_by,
  created_at
)
SELECT
  ia.organization_id,
  ia.warehouse_id,
  ia.product_id,
  CASE WHEN ia.source_type = 'purchase' THEN 'purchase' ELSE 'adjustment' END,
  ia.delta,
  ia.new_quantity,
  CASE WHEN ia.source_type = 'purchase' THEN 'purchase' ELSE 'adjustment' END,
  CASE WHEN ia.source_type = 'purchase' THEN ia.purchase_order_id ELSE ia.id END,
  ia.created_by_user_id,
  ia.created_at
FROM inventory_adjustments ia
WHERE ia.source_type = 'manual'
   OR (ia.source_type = 'purchase' AND ia.purchase_order_id IS NOT NULL AND ia.delta > 0)
ON CONFLICT (source_type, source_id, warehouse_id, product_id) DO NOTHING;

-- Reservas: disponible = quantity - reserved_quantity.
ALTER TABLE inventory_balances
  ADD COLUMN IF NOT EXISTS reserved_quantity NUMERIC(14, 3) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_balances_reserved_within_quantity'
  ) THEN
    ALTER TABLE inventory_balances
      ADD CONSTRAINT inventory_balances_reserved_within_quantity
      CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity);
  END IF;
END;
$$;

-- Deposito del pedido (se fija al confirmar) y fecha de entrega (base de Ventas).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS warehouse_id UUID NULL,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_warehouse_org_fk') THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_warehouse_org_fk
      FOREIGN KEY (warehouse_id, organization_id)
      REFERENCES warehouses (id, organization_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS orders_warehouse_id_idx ON orders (warehouse_id);
CREATE INDEX IF NOT EXISTS orders_delivered_at_idx
  ON orders (organization_id, delivered_at DESC)
  WHERE status = 'delivered';

-- Pedidos entregados antes de 6.1: la fecha de entrega sale del historial de estados.
UPDATE orders o
SET delivered_at = h.delivered_at
FROM (
  SELECT order_id, MAX(created_at) AS delivered_at
  FROM order_status_history
  WHERE to_status = 'delivered'
  GROUP BY order_id
) h
WHERE h.order_id = o.id
  AND o.status = 'delivered'
  AND o.delivered_at IS NULL;

UPDATE orders
SET delivered_at = updated_at
WHERE status = 'delivered'
  AND delivered_at IS NULL;
