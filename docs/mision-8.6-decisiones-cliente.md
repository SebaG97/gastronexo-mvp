# Misión 8.6 - Decisiones del cliente: nombres de producto únicos (H13) y moneda (H17)

## Decisiones

- **H13:** no se permiten productos con el mismo nombre.
- **H17:** la moneda es el guaraní (`Gs.`). No requiere cambios: ya se mostraba así.

## Cambios (H13)

- **Migración `012_product_name_unique.sql`:** índice único `products_org_name_ci_unique` sobre `(organization_id, lower(btrim(name)))`, como en categorías, depósitos, proveedores, cortes y clientes.
  - "Tomate", "tomate" y " Tomate " cuentan como el mismo nombre.
  - Incluye a los **inactivos**: para volver a usar un nombre, se reactiva el producto o se lo renombra.
- **Duplicados que ya existían:** el más antiguo conserva el nombre y los demás reciben el sufijo " (2)", " (3)", etc. Así el índice se crea sin borrar datos. En la base local había uno ("Zanahoria rallada QA 7716", de una org de QA).
- **API:** crear o renombrar con un nombre repetido devuelve 409 con el mensaje "Ya existe un producto con ese nombre (puede estar inactivo). Usá otro nombre o reactivá el existente.". El SKU repetido sigue respondiendo con su propio mensaje. La consola ya muestra el mensaje de la API en el formulario.
- La garantía la da la base de datos, no un chequeo previo, así que tampoco hay duplicados con altas simultáneas.

## Verificación

- Backup antes de migrar: `~/gastronexo-backups/pre-mision-8.6-*.dump`.
- Resultados del script contra la API local:

| Caso | Resultado |
| --- | --- |
| Alta nueva | 201 |
| Mismo nombre con otras mayúsculas y espacios | 409 |
| Renombrar a un nombre existente | 409 |
| Guardar un producto con su propio nombre | 200 |
| Mismo nombre que un producto inactivo | 409 |
| SKU repetido | 409, con el mensaje del SKU |
| 8 altas simultáneas con el mismo nombre | 1×201 + 7×409 |

- `stress:writes` OK (371 escrituras, 0 deadlocks) y `check:consistency` OK.
- El seed de la demo ya buscaba los productos por nombre antes de crearlos, así que sigue siendo repetible.
