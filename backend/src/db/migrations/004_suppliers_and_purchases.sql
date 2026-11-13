CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tax_id TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX suppliers_org_name_ci_unique
  ON suppliers (organization_id, lower(name));

CREATE INDEX suppliers_organization_id_idx ON suppliers (organization_id);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  payment_method TEXT NOT NULL,
  notes TEXT,
  total_amount NUMERIC(14, 2) NOT NULL CHECK (total_amount >= 0),
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX purchase_orders_organization_id_idx ON purchase_orders (organization_id);
CREATE INDEX purchase_orders_supplier_id_idx ON purchase_orders (supplier_id);
CREATE INDEX purchase_orders_purchase_date_idx ON purchase_orders (purchase_date DESC);
CREATE INDEX purchase_orders_warehouse_id_idx ON purchase_orders (warehouse_id);

CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12, 2) NOT NULL CHECK (unit_cost > 0),
  line_total NUMERIC(14, 2) NOT NULL CHECK (line_total > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX purchase_order_items_purchase_order_id_idx ON purchase_order_items (purchase_order_id);
CREATE INDEX purchase_order_items_product_id_idx ON purchase_order_items (product_id);

ALTER TABLE inventory_adjustments
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'purchase')),
  ADD COLUMN purchase_order_id UUID NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT;

CREATE INDEX inventory_adjustments_purchase_order_id_idx
  ON inventory_adjustments (purchase_order_id);
