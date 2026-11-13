# Auditoría de conexiones y concurrencia (Misión 6.3, Fase 1)

Relevamiento del backend **antes de corregir nada**, sobre el commit `c4ad15b`. Cubre todos los endpoints de escritura de `auth`, `organization`, `products`, `inventory`, `purchases`, `orders`, `customers` y `production`.

## Contexto de infraestructura (estado actual)

- `db/pool.ts` crea un único `Pool` sin configuración: `max = 10` (default de `pg`), `connectionTimeoutMillis = 0` (**espera infinita** por una conexión libre), sin `statement_timeout`, `lock_timeout` ni `idle_in_transaction_session_timeout`.
- `/ready` usa ese mismo pool. Si el pool está agotado, `/ready` queda en cola para siempre igual que el resto.
- No hay helper de transacciones: hay 17 handlers que hacen `pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK` + `release()` a mano, cada módulo con su propio `rollbackTransaction`.
- El error handler responde 500 a cualquier error de PostgreSQL, incluido un *deadlock* (`40P01`).
- El `preHandler` de autorización (`getOrganizationAccess`) hace un `pool.query` **antes** del handler. Toma y devuelve su conexión antes de que empiece la transacción, así que no anida conexiones.

## Tabla por endpoint de escritura

Leyenda: **Tx**: cómo abre la transacción. **2ª conexión**: `pool.query` (u otra conexión) usada mientras la transacción todavía retiene su `client` (violación de la decisión 1). **Bloqueos**: filas con `FOR UPDATE` en el orden en que se toman.

| Endpoint | Tx | 2ª conexión con la tx abierta | Bloqueos (en orden) | Lectura posterior al commit | Hallazgo |
| --- | --- | --- | --- | --- | --- |
| `POST /api/auth/register` | a mano | no | ninguno | no | **A1** |
| `POST /api/auth/login`, `POST /switch-organization` | sin tx (lecturas) | n/a | ninguno | n/a | ok |
| `POST /api/organization/members` | a mano | no | ninguno | no | ok |
| `PATCH /api/organization/members/:userId` | a mano | no | `memberships` (destino) | no | O1 (pendiente) |
| `DELETE /api/organization/members/:userId` | a mano | no | `memberships` (destino) | no | O1 (pendiente) |
| `POST/PATCH /api/customers`, `PATCH /:id/status` | sin tx (una sentencia) | n/a | implícito del UPDATE | n/a | ok |
| `POST/PATCH /api/suppliers`, `PATCH /:id/status` | sin tx (una sentencia) | n/a | implícito del UPDATE | n/a | ok |
| `POST/PATCH /api/cut-types`, `PATCH /:id/status` | sin tx (una sentencia) | n/a | implícito del UPDATE | n/a | ok |
| `POST/PATCH /api/product-categories` | sin tx (una sentencia) | n/a | implícito | n/a | ok |
| `PATCH /api/product-categories/:id/status` | a mano | no | ninguno | no | ok |
| `POST /api/products`, `PATCH /api/products/:id` | a mano | no | ninguno | no | ok |
| `PATCH /api/products/:id/status` | sin tx | n/a | implícito del UPDATE | `getCategoryName(pool)` secuencial, sin tx abierta | ok |
| `POST /api/products/:id/cut-options` | a mano | **sí**: `getProductCutOptions(pool)` después del `COMMIT` y antes del `release()` | ninguno | sí, con `pool` | **A2** |
| `PATCH /api/products/:id/cut-options/:optionId` | a mano | **sí**: ídem | ninguno | sí, con `pool` | **A2** |
| `POST /api/warehouses`, `PATCH /:id` | sin tx (una sentencia) | n/a | implícito | n/a | ok |
| `PATCH /api/warehouses/:id/status` | a mano | no | ninguno (no bloquea el depósito) | no | W1 (pendiente) |
| `POST /api/inventory/adjustments` | a mano | no | `inventory_balances` (1 fila, **solo si ya existe**) | no | **A3** |
| `POST /api/purchases` | a mano | **sí**: `getPurchaseById(pool)` después del `COMMIT` | por producto, intercalado: `balance(p1)` → `products(p1)` `FOR UPDATE` → `balance(p2)` → `products(p2)` … El balance faltante se crea **a mitad de la transacción** | sí, con `pool` | **A2, A4, A5, A6** |
| `POST /api/orders` | a mano | **sí**: `getOrderById(pool)` después del `COMMIT` | `order_number_sequences` (upsert) | sí, con `pool` | **A2** |
| `PATCH /api/orders/:id` | a mano | **sí**: `getOrderById(pool)` después del `COMMIT`; `getWarehouseName(pool)` en la rama 409 | `orders` → `inventory_balances` (`ORDER BY product_id`) | sí, con `pool` | **A2** |
| `PATCH /api/orders/:id/status` (confirmar, preparar, listo, entregar, cancelar) | a mano | **sí**: `getOrderById(pool)` después del `COMMIT` | `orders` → `inventory_balances` (`ORDER BY product_id`) | sí, con `pool` | **A2** |
| `POST /api/recipes`, `PATCH /:id`, `PATCH /:id/status` | a mano | no (corregido en 6.2) | `recipes` (edición/estado) | sí, con el mismo `client` | ok |
| `POST /api/production-runs/preview` | sin tx (lecturas) | n/a | ninguno | n/a | ok |
| `POST /api/production-runs` | a mano | no (corregido en 6.2) | asegura balance del terminado → `inventory_balances` (`ORDER BY product_id`) → `products` (terminado) `FOR UPDATE` → `production_run_sequences` | sí, con el mismo `client` | A5 |
| `POST /api/production-runs/:id/void` | a mano | no (corregido en 6.2) | `production_runs` → `inventory_balances` (`ORDER BY product_id`) → `products` `FOR UPDATE ORDER BY id` | sí, con el mismo `client` | A5 |

## Hallazgos

- **A1 · Registro devuelve la conexión con una transacción abierta.** `POST /auth/register` responde 409 (email o slug en uso) **sin `ROLLBACK`** y libera el `client`. La conexión vuelve al pool en estado `idle in transaction`. La próxima request que la tome ejecuta sus sentencias dentro de esa transacción vieja: un `pool.query` de escritura (por ejemplo, alta de cliente) quedaría sin confirmar hasta que otra request haga `COMMIT` o `ROLLBACK` en la misma conexión. Hoy pasa desapercibido porque las transacciones posteriores emiten `BEGIN` (warning) y su `COMMIT` cierra todo.
- **A2 · Segunda conexión con la primera retenida (decisión 1).** Pedidos (crear, editar, cambio de estado), Compras (crear) y cortes de producto releen el resultado con `pool.query` **antes** de `client.release()`. Con ≥ `max` requests concurrentes, cada una retiene su conexión esperando otra que nunca se libera: la API se cuelga, `/ready` incluido, porque `connectionTimeoutMillis = 0`. Es el mismo defecto que 6.2 corrigió solo en Producción.
- **A3 · Ajuste manual sobre un balance inexistente no bloquea nada.** Si el balance no existe, `SELECT … FOR UPDATE` no devuelve filas y dos ajustes concurrentes leen `previous_quantity = 0`. El segundo hace `ON CONFLICT DO UPDATE SET quantity = nuevo` sobre la fila que creó el primero, y registra un movimiento con `delta = nuevo − 0`. Resultado: la suma de movimientos deja de coincidir con `quantity` (rompe la invariante del ledger de 6.1) y no se valida lo reservado.
- **A4 · Compras bloquea en otro orden que el resto (decisión 4).** Compras intercala `balance(p)` → `products(p)` producto por producto. Producción y anulación bloquean **todos** los balances y **después** los productos. Una compra de `{A, B}` puede tener `products(A)` y esperar `balance(B)` mientras una anulación tiene `balance(B)` y espera `products(A)`: *deadlock*. Además, Compras crea el balance faltante a mitad de la transacción, el mismo patrón que causó el *deadlock* de 6.2.
- **A5 · `FOR UPDATE` sobre `products` choca con las FK.** Insertar en `inventory_balances`, `inventory_movements`, `purchase_order_items`, `order_items` o `production_run_items` toma `FOR KEY SHARE` sobre la fila referenciada de `products`. `FOR UPDATE` es incompatible con `FOR KEY SHARE`, así que dos compras del mismo producto pueden bloquearse en cruz: T1 inserta ítems (KEY SHARE en A) y espera `balance(A)`; T2 tiene `balance(A)` y espera `products(A) FOR UPDATE`, que bloquea el KEY SHARE de T1. El costo solo se actualiza (no cambia la clave), así que el modo correcto es `FOR NO KEY UPDATE`, que serializa a los que recalculan costo sin chocar con las FK.
- **A6 · Sin límites de espera ni mapeo de errores de infraestructura.** Sin `connectionTimeoutMillis`, `lock_timeout` ni `statement_timeout`, una contención o un pool agotado se traducen en requests colgadas en vez de un 503 rápido. Un *deadlock* llega al cliente como 500.
- **Rollback que falla.** Los `rollbackTransaction` locales tragan el error y devuelven el `client` al pool igual. Si la conexión quedó rota, vuelve al pool en mal estado.

### Observaciones fuera de alcance (no se corrigen en 6.3)

- **O1 · Último owner.** `PATCH`/`DELETE` de miembros bloquean solo la fila destino y cuentan los owners sin bloquear. Dos owners que se degradan en paralelo pueden dejar la organización sin owner. Es una regla de negocio de 1.x; se documenta para una misión de miembros.
- **W1 · Inactivar depósito.** No bloquea el depósito ni sus balances. Un ajuste concurrente puede dejar stock en un depósito recién inactivado. Mismo criterio: regla de negocio, sin cambios en 6.3.

## Orden de bloqueo canónico (a aplicar en la Fase 2)

Toda transacción toma los recursos en este orden y salta los niveles que no usa:

1. **Fila cabecera del documento** (`orders`, `production_runs`, `recipes`, `memberships`), `FOR UPDATE`. Una sola por transacción.
2. **`inventory_balances`**: primero se **asegura** que existan los que la transacción va a incrementar (`INSERT … ON CONFLICT DO NOTHING`, ordenado), y después `FOR UPDATE ORDER BY product_id, warehouse_id`.
3. **`products`** (costo promedio): `FOR NO KEY UPDATE ORDER BY id`.
4. **Secuencias de numeración** (`order_number_sequences`, `production_run_sequences`): al final, justo antes de insertar el documento.

Infracciones actuales: Compras (A4: intercala 2 y 3; crea balances a mitad de camino), Ajustes (A3: no asegura el balance), y `FOR UPDATE` en lugar de `FOR NO KEY UPDATE` en Compras, Producción y Anulación (A5).

## ¿Contradice alguna decisión de la misión?

No. Las cuatro decisiones (una transacción = una conexión, helper central, 503 rápido ante agotamiento, orden de bloqueo uniforme) se pueden aplicar sin cambiar contratos de API ni reglas de 5.2, 6.1 o 6.2, y sin migraciones. Se sigue con la Fase 2.
