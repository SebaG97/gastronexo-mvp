ALTER TABLE products
  ADD COLUMN product_type TEXT NOT NULL DEFAULT 'raw_material'
  CHECK (product_type IN ('raw_material', 'finished_product'));

CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX warehouses_org_name_ci_unique
  ON warehouses (organization_id, lower(name));

CREATE INDEX warehouses_organization_id_idx ON warehouses (organization_id);

CREATE TABLE inventory_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (warehouse_id, product_id)
);

CREATE INDEX inventory_balances_organization_id_idx ON inventory_balances (organization_id);
CREATE INDEX inventory_balances_warehouse_id_idx ON inventory_balances (warehouse_id);
CREATE INDEX inventory_balances_product_id_idx ON inventory_balances (product_id);

CREATE TABLE inventory_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  previous_quantity NUMERIC(14, 3) NOT NULL CHECK (previous_quantity >= 0),
  new_quantity NUMERIC(14, 3) NOT NULL CHECK (new_quantity >= 0),
  delta NUMERIC(14, 3) NOT NULL,
  reason TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (delta = (new_quantity - previous_quantity))
);

CREATE INDEX inventory_adjustments_organization_id_idx ON inventory_adjustments (organization_id);
CREATE INDEX inventory_adjustments_warehouse_id_idx ON inventory_adjustments (warehouse_id);
CREATE INDEX inventory_adjustments_product_id_idx ON inventory_adjustments (product_id);
CREATE INDEX inventory_adjustments_created_at_idx ON inventory_adjustments (created_at DESC);
