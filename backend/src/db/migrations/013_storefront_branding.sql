-- Mision 8.8: marca de la tienda. Logo, foto de portada y color de la cabecera.
--
-- Las imagenes se suben por la API (como las fotos de productos, 8.7): aca se guarda su URL.
-- brand_color es el color de la cabecera (#rrggbb). Sin valor, la tienda usa el verde de siempre.
-- La API exige que tenga contraste suficiente con el texto claro de la cabecera.

ALTER TABLE storefront_settings
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS brand_color TEXT;

ALTER TABLE storefront_settings
  DROP CONSTRAINT IF EXISTS storefront_settings_brand_color_format;

ALTER TABLE storefront_settings
  ADD CONSTRAINT storefront_settings_brand_color_format
    CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-f]{6}$');
