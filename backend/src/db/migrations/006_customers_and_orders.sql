CREATE TYPE order_status AS ENUM (
  'new',
  'confirmed',
  'preparing',
  'ready',
  'delivered',
  'cancelled'
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  business_name TEXT,
  document_number TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX customers_org_name_ci_unique
  ON customers (organization_id, lower(name));

CREATE INDEX customers_organization_id_idx ON customers (organization_id);
CREATE INDEX customers_is_active_idx ON customers (organization_id, is_active);
CREATE UNIQUE INDEX customers_id_organization_id_unique ON customers (id, organization_id);

CREATE TABLE order_number_sequences (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_id UUID NOT NULL,
  status order_status NOT NULL DEFAULT 'new',
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  requested_delivery_date DATE,
  notes TEXT,
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_customer_org_fk
    FOREIGN KEY (customer_id, organization_id)
    REFERENCES customers (id, organization_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX orders_org_order_number_unique
  ON orders (organization_id, order_number);

CREATE INDEX orders_organization_id_idx ON orders (organization_id);
CREATE INDEX orders_customer_id_idx ON orders (customer_id);
CREATE INDEX orders_status_idx ON orders (organization_id, status);
CREATE INDEX orders_order_date_idx ON orders (organization_id, order_date DESC);
CREATE UNIQUE INDEX orders_id_organization_id_unique ON orders (id, organization_id);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  cut_type_id UUID,
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price > 0),
  cut_price_modifier NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cut_price_modifier >= 0),
  subtotal NUMERIC(14, 2) NOT NULL CHECK (subtotal > 0),
  product_name_snapshot TEXT NOT NULL,
  product_unit_snapshot TEXT NOT NULL,
  cut_name_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_items_order_org_fk
    FOREIGN KEY (order_id, organization_id)
    REFERENCES orders (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT order_items_product_org_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES products (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT order_items_cut_type_org_fk
    FOREIGN KEY (cut_type_id, organization_id)
    REFERENCES cut_types (id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX order_items_order_id_idx ON order_items (order_id);
CREATE INDEX order_items_product_id_idx ON order_items (product_id);
CREATE INDEX order_items_cut_type_id_idx ON order_items (cut_type_id);

CREATE TABLE order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status order_status NOT NULL,
  changed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX order_status_history_order_id_idx ON order_status_history (order_id, created_at);
