-- Mision 7.2: tienda publica con carrito. Los pedidos de la tienda entran al mismo motor de pedidos.

CREATE TABLE storefront_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  display_name TEXT,
  tagline TEXT,
  contact_phone TEXT,
  whatsapp_phone TEXT,
  contact_email TEXT,
  pickup_address TEXT,
  opening_hours TEXT,
  cutoff_notice TEXT,
  min_order_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  allows_pickup BOOLEAN NOT NULL DEFAULT TRUE,
  allows_delivery BOOLEAN NOT NULL DEFAULT TRUE,
  payment_methods TEXT[] NOT NULL DEFAULT ARRAY['cash', 'transfer']::TEXT[],
  transfer_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT storefront_settings_payment_methods_valid
    CHECK (payment_methods <@ ARRAY['cash', 'transfer', 'card_on_delivery']::TEXT[])
);

CREATE TABLE delivery_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX delivery_zones_org_name_ci_unique ON delivery_zones (organization_id, lower(name));
CREATE UNIQUE INDEX delivery_zones_id_organization_id_unique ON delivery_zones (id, organization_id);

ALTER TABLE products
  ADD COLUMN description TEXT,
  ADD COLUMN image_url TEXT;

ALTER TABLE customers ADD COLUMN phone_normalized TEXT;

-- Solo los clientes creados por la tienda llevan telefono normalizado: los existentes no se tocan.
CREATE UNIQUE INDEX customers_org_phone_normalized_unique
  ON customers (organization_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE TYPE order_channel AS ENUM ('admin', 'storefront');
CREATE TYPE order_fulfillment_type AS ENUM ('pickup', 'delivery');

ALTER TABLE orders
  ADD COLUMN channel order_channel NOT NULL DEFAULT 'admin',
  ADD COLUMN fulfillment_type order_fulfillment_type,
  ADD COLUMN delivery_zone_id UUID,
  ADD COLUMN delivery_zone_name TEXT,
  ADD COLUMN delivery_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  ADD COLUMN delivery_address TEXT,
  ADD COLUMN delivery_reference TEXT,
  ADD COLUMN payment_method TEXT,
  ADD COLUMN cash_change_for NUMERIC(12, 2) CHECK (cash_change_for IS NULL OR cash_change_for >= 0),
  ADD COLUMN contact_name TEXT,
  ADD COLUMN contact_phone TEXT,
  ADD COLUMN contact_email TEXT,
  ADD COLUMN public_token TEXT,
  ADD COLUMN idempotency_key TEXT,
  ALTER COLUMN created_by DROP NOT NULL,
  ADD CONSTRAINT orders_created_by_required_for_admin
    CHECK (channel = 'storefront' OR created_by IS NOT NULL),
  ADD CONSTRAINT orders_delivery_zone_org_fk
    FOREIGN KEY (delivery_zone_id, organization_id)
    REFERENCES delivery_zones (id, organization_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT orders_payment_method_valid
    CHECK (payment_method IS NULL OR payment_method IN ('cash', 'transfer', 'card_on_delivery'));

CREATE UNIQUE INDEX orders_public_token_unique ON orders (public_token) WHERE public_token IS NOT NULL;
CREATE UNIQUE INDEX orders_org_idempotency_key_unique
  ON orders (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX orders_channel_idx ON orders (organization_id, channel, created_at DESC);

-- La fila inicial del historial de un pedido de la tienda no tiene usuario.
ALTER TABLE order_status_history ALTER COLUMN changed_by DROP NOT NULL;
