CREATE TABLE product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX product_categories_org_name_ci_unique
  ON product_categories (organization_id, lower(name));

CREATE INDEX product_categories_organization_id_idx ON product_categories (organization_id);

ALTER TABLE products
  ADD COLUMN category_id UUID NULL REFERENCES product_categories(id);

CREATE INDEX products_category_id_idx ON products (category_id);