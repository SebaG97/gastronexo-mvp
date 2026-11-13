-- Mision 8.3: mermas (perdidas de stock) con costo y anulacion.
--
-- Una merma saca stock disponible de un producto en un deposito. Se numera MER-000001 por
-- organizacion, congela el costo del producto (para medir el impacto economico) y no cambia el
-- costo promedio (como una venta). Anular devuelve el stock con un movimiento inverso: el
-- ledger sigue siendo inmutable.

CREATE TABLE IF NOT EXISTS waste_sequences (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

CREATE TABLE IF NOT EXISTS waste_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  waste_number TEXT NOT NULL,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL CHECK (reason IN ('expired', 'damaged', 'preparation', 'missing', 'other')),
  notes TEXT,
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  unit_cost NUMERIC(14, 4) NOT NULL CHECK (unit_cost >= 0),
  total_cost NUMERIC(14, 2) NOT NULL CHECK (total_cost >= 0),
  product_name_snapshot TEXT NOT NULL,
  product_unit_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_by UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  voided_at TIMESTAMPTZ NULL,
  void_reason TEXT NULL,
  CONSTRAINT waste_records_product_org_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES products (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT waste_records_warehouse_org_fk
    FOREIGN KEY (warehouse_id, organization_id)
    REFERENCES warehouses (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT waste_records_other_needs_notes CHECK (reason <> 'other' OR length(trim(coalesce(notes, ''))) > 0),
  CONSTRAINT waste_records_void_fields CHECK (
    (status = 'completed' AND voided_at IS NULL AND voided_by IS NULL)
    OR (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS waste_records_org_number_unique
  ON waste_records (organization_id, waste_number);
CREATE INDEX IF NOT EXISTS waste_records_org_occurred_idx
  ON waste_records (organization_id, occurred_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS waste_records_product_idx ON waste_records (product_id);

-- Ledger: tipo `waste` con dos origenes (source_id = waste_record_id).
--   waste:      salida por merma (delta < 0)
--   waste_void: devolucion al anular (delta > 0)
ALTER TABLE inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check,
  DROP CONSTRAINT IF EXISTS inventory_movements_source_type_check,
  DROP CONSTRAINT IF EXISTS inventory_movements_delta_sign,
  DROP CONSTRAINT IF EXISTS inventory_movements_type_matches_source;

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK (movement_type IN ('purchase', 'adjustment', 'sale', 'production', 'waste')),
  ADD CONSTRAINT inventory_movements_source_type_check
    CHECK (source_type IN (
      'purchase',
      'adjustment',
      'order_delivery',
      'production_consumption',
      'production_output',
      'production_void',
      'waste',
      'waste_void'
    )),
  ADD CONSTRAINT inventory_movements_delta_sign CHECK (
    (movement_type = 'purchase' AND quantity_delta > 0)
    OR (movement_type = 'sale' AND quantity_delta < 0)
    OR movement_type = 'adjustment'
    OR (source_type = 'production_consumption' AND quantity_delta < 0)
    OR (source_type = 'production_output' AND quantity_delta > 0)
    OR (source_type = 'production_void' AND quantity_delta <> 0)
    OR (source_type = 'waste' AND quantity_delta < 0)
    OR (source_type = 'waste_void' AND quantity_delta > 0)
  ),
  ADD CONSTRAINT inventory_movements_type_matches_source CHECK (
    (movement_type = 'purchase' AND source_type = 'purchase')
    OR (movement_type = 'adjustment' AND source_type = 'adjustment')
    OR (movement_type = 'sale' AND source_type = 'order_delivery')
    OR (
      movement_type = 'production'
      AND source_type IN ('production_consumption', 'production_output', 'production_void')
    )
    OR (movement_type = 'waste' AND source_type IN ('waste', 'waste_void'))
  );
