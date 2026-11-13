-- Mision 8.6 (H13): no se permiten dos productos con el mismo nombre en una organizacion.
--
-- Igual que categorias, depositos, proveedores, cortes y clientes: unico sin distinguir
-- mayusculas ni espacios al borde. Incluye los inactivos (para volver a usar un nombre se
-- reactiva el producto existente o se lo renombra).
--
-- Si ya hubiera duplicados, el mas antiguo conserva el nombre y los demas reciben un sufijo
-- " (2)", " (3)"... para que el indice se pueda crear sin borrar datos.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY organization_id, lower(btrim(name))
      ORDER BY created_at, id
    ) AS position
  FROM products
)
UPDATE products p
SET name = left(btrim(p.name), 150) || ' (' || ranked.position || ')',
    updated_at = NOW()
FROM ranked
WHERE ranked.id = p.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS products_org_name_ci_unique
  ON products (organization_id, lower(btrim(name)));
