ALTER TABLE products
  ADD COLUMN is_sellable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN is_catalog_visible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN sale_price NUMERIC(12, 2) NULL CHECK (sale_price IS NULL OR sale_price >= 0),
  ADD CONSTRAINT products_catalog_visibility_requires_sellable
    CHECK (is_catalog_visible = FALSE OR is_sellable = TRUE);

CREATE TABLE cut_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX cut_types_org_name_ci_unique
  ON cut_types (organization_id, lower(name));

CREATE INDEX cut_types_organization_id_idx ON cut_types (organization_id);
CREATE UNIQUE INDEX cut_types_id_organization_id_unique ON cut_types (id, organization_id);

CREATE UNIQUE INDEX products_id_organization_id_unique ON products (id, organization_id);

CREATE TABLE product_cut_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  cut_type_id UUID NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  price_modifier NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price_modifier >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_cut_options_product_org_fk
    FOREIGN KEY (product_id, organization_id)
    REFERENCES products (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT product_cut_options_cut_type_org_fk
    FOREIGN KEY (cut_type_id, organization_id)
    REFERENCES cut_types (id, organization_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX product_cut_options_product_cut_unique
  ON product_cut_options (product_id, cut_type_id);

CREATE UNIQUE INDEX product_cut_options_one_active_default
  ON product_cut_options (product_id)
  WHERE is_active = TRUE AND is_default = TRUE;

CREATE INDEX product_cut_options_organization_id_idx ON product_cut_options (organization_id);
CREATE INDEX product_cut_options_product_id_idx ON product_cut_options (product_id);
CREATE INDEX product_cut_options_cut_type_id_idx ON product_cut_options (cut_type_id);
CREATE INDEX product_cut_options_sort_order_idx ON product_cut_options (product_id, sort_order, created_at);
