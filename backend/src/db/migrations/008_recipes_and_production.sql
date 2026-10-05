-- Mision 6.2: recetas y producciones (materia prima -> producto terminado) sobre el ledger de 6.1.
-- Idempotente: puede re-ejecutarse sobre una base que ya la tenga aplicada.

CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  yield_quantity NUMERIC(14, 3) NOT NULL CHECK (yield_quantity > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recipes_product_org_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES products (id, organization_id)
    ON DELETE RESTRICT
);

-- Una sola receta activa por producto terminado; las inactivas quedan como historial.
CREATE UNIQUE INDEX IF NOT EXISTS recipes_one_active_per_product
  ON recipes (organization_id, product_id)
  WHERE is_active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS recipes_id_organization_id_unique ON recipes (id, organization_id);
CREATE INDEX IF NOT EXISTS recipes_organization_id_idx ON recipes (organization_id, is_active);
CREATE INDEX IF NOT EXISTS recipes_product_id_idx ON recipes (product_id);

CREATE TABLE IF NOT EXISTS recipe_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  ingredient_product_id UUID NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recipe_items_recipe_org_fk
    FOREIGN KEY (recipe_id, organization_id)
    REFERENCES recipes (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT recipe_items_ingredient_org_fk
    FOREIGN KEY (ingredient_product_id, organization_id)
    REFERENCES products (id, organization_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS recipe_items_recipe_ingredient_unique
  ON recipe_items (recipe_id, ingredient_product_id);
CREATE INDEX IF NOT EXISTS recipe_items_ingredient_idx ON recipe_items (ingredient_product_id);

CREATE TABLE IF NOT EXISTS production_run_sequences (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

CREATE TABLE IF NOT EXISTS production_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  run_number TEXT NOT NULL,
  product_id UUID NOT NULL,
  recipe_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  quantity_produced NUMERIC(14, 3) NOT NULL CHECK (quantity_produced > 0),
  unit_cost NUMERIC(14, 4) NOT NULL CHECK (unit_cost >= 0),
  total_cost NUMERIC(14, 2) NOT NULL CHECK (total_cost >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  product_name_snapshot TEXT NOT NULL,
  product_unit_snapshot TEXT NOT NULL,
  recipe_yield_snapshot NUMERIC(14, 3) NOT NULL CHECK (recipe_yield_snapshot > 0),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_by UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  voided_at TIMESTAMPTZ NULL,
  void_reason TEXT NULL,
  CONSTRAINT production_runs_product_org_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES products (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT production_runs_recipe_org_fk
    FOREIGN KEY (recipe_id, organization_id)
    REFERENCES recipes (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT production_runs_warehouse_org_fk
    FOREIGN KEY (warehouse_id, organization_id)
    REFERENCES warehouses (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT production_runs_void_fields CHECK (
    (status = 'completed' AND voided_at IS NULL AND voided_by IS NULL)
    OR (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS production_runs_org_run_number_unique
  ON production_runs (organization_id, run_number);
CREATE UNIQUE INDEX IF NOT EXISTS production_runs_id_organization_id_unique
  ON production_runs (id, organization_id);
CREATE INDEX IF NOT EXISTS production_runs_org_created_at_idx
  ON production_runs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS production_runs_product_id_idx ON production_runs (product_id);
CREATE INDEX IF NOT EXISTS production_runs_recipe_id_idx ON production_runs (recipe_id);
CREATE INDEX IF NOT EXISTS production_runs_warehouse_id_idx ON production_runs (warehouse_id);

-- Snapshot de lo consumido: el historial no cambia si despues se edita la receta o el costo.
CREATE TABLE IF NOT EXISTS production_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_run_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  product_unit_snapshot TEXT NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12, 2) NOT NULL CHECK (unit_cost >= 0),
  subtotal NUMERIC(14, 2) NOT NULL CHECK (subtotal >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT production_run_items_run_org_fk
    FOREIGN KEY (production_run_id, organization_id)
    REFERENCES production_runs (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT production_run_items_product_org_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES products (id, organization_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS production_run_items_run_product_unique
  ON production_run_items (production_run_id, product_id);
CREATE INDEX IF NOT EXISTS production_run_items_product_id_idx ON production_run_items (product_id);

-- Los snapshots tampoco se editan: misma regla que el ledger.
CREATE OR REPLACE FUNCTION reject_immutable_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% es inmutable: % no permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS production_run_items_no_update_delete ON production_run_items;
CREATE TRIGGER production_run_items_no_update_delete
  BEFORE UPDATE OR DELETE ON production_run_items
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();

-- Ledger: nuevo tipo `production` con tres origenes (source_id = production_run_id).
--   production_consumption: materia prima consumida (delta < 0)
--   production_output:      terminado producido (delta > 0)
--   production_void:        movimiento inverso al anular (delta != 0)
-- La anulacion usa su propio source_type porque el indice unico
-- (source_type, source_id, warehouse_id, product_id) impide repetir el del movimiento original.
ALTER TABLE inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check,
  DROP CONSTRAINT IF EXISTS inventory_movements_source_type_check,
  DROP CONSTRAINT IF EXISTS inventory_movements_delta_sign,
  DROP CONSTRAINT IF EXISTS inventory_movements_type_matches_source;

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK (movement_type IN ('purchase', 'adjustment', 'sale', 'production')),
  ADD CONSTRAINT inventory_movements_source_type_check
    CHECK (source_type IN (
      'purchase',
      'adjustment',
      'order_delivery',
      'production_consumption',
      'production_output',
      'production_void'
    )),
  ADD CONSTRAINT inventory_movements_delta_sign CHECK (
    (movement_type = 'purchase' AND quantity_delta > 0)
    OR (movement_type = 'sale' AND quantity_delta < 0)
    OR movement_type = 'adjustment'
    OR (source_type = 'production_consumption' AND quantity_delta < 0)
    OR (source_type = 'production_output' AND quantity_delta > 0)
    OR (source_type = 'production_void' AND quantity_delta <> 0)
  ),
  ADD CONSTRAINT inventory_movements_type_matches_source CHECK (
    (movement_type = 'purchase' AND source_type = 'purchase')
    OR (movement_type = 'adjustment' AND source_type = 'adjustment')
    OR (movement_type = 'sale' AND source_type = 'order_delivery')
    OR (
      movement_type = 'production'
      AND source_type IN ('production_consumption', 'production_output', 'production_void')
    )
  );
