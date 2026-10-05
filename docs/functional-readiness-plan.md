# Functional Readiness Plan

## Misión 6.2 - Producción: recetas y transformación de materia prima en producto terminado

Recetas por producto terminado y producciones que consumen materia prima y suman terminado, con movimientos en el ledger inmutable de 6.1 y costo promedio ponderado. Reemplaza el placeholder de Producción.

### Fase 0 - Preparación

- Rama `sebag97-mvp-inicial` limpia. `pg_dump -Fc` de la base local fuera del repo (`~/gastronexo-backups/pre-mision-6.2-20261005-152244.dump`, 105 KB) antes de migrar.

### Fase 1 - Auditoría (antes de escribir código)

1. **Costo:** vive en `products.cost NUMERIC(12,2)`, uno por producto (no por depósito). Compras lo recalcula como `(cantidad_global_antes × costo + total_entrante) / cantidad_global_después`, con cantidad global = `SUM(inventory_balances.quantity)` en todos los depósitos (incluye lo reservado). Redondea a 2 decimales y bloquea la fila del producto con `FOR UPDATE`. Las salidas (ventas) no tocan el costo.
2. **Ledger:** todas las escrituras pasan por `recordMovement()` (`stock-ledger.ts`). `movement_type ∈ {purchase, adjustment, sale}` y `source_type ∈ {purchase, adjustment, order_delivery}`, con CHECK de signo por tipo y de correspondencia 1:1 tipo↔origen. Hay un único `(source_type, source_id, warehouse_id, product_id)` y un trigger contra UPDATE/DELETE/TRUNCATE.
3. **`product_type`:** CHECK `raw_material|finished_product`. Compras solo acepta `raw_material` activo. Pedidos no miran el tipo (solo `is_sellable` + precio). Hasta 6.1, un terminado solo recibía stock por ajuste manual. `PATCH /products` permite cambiar el tipo libremente.
4. **Bloqueos:** `lockBalances()` hace `SELECT … FOR UPDATE ORDER BY product_id` y solo bloquea filas existentes (un balance inexistente cuenta como disponible 0). Compras bloquea balance → producto, producto por producto en orden. La numeración usa una tabla de secuencia por organización con upsert (`order_number_sequences`).
5. **Contradicciones con el plan y cómo se resolvieron:**
   - Los CHECK atan `movement_type` a `source_type`, así que nuevos `source_type` solos no alcanzan. Se agregó `movement_type = 'production'`.
   - La anulación no puede reutilizar el `source_type` del movimiento original con el mismo `source_id` (índice único). Se agregó un tercer origen, `production_void`.
   - El tipo de un producto puede cambiar después de cargar la receta. Producción y vista previa revalidan en el momento (400 `invalid_recipe` / `invalid_product`). Productos no se tocó.
   - El plan no definía el costo al anular. El terminado revierte el promedio ponderado (piso 0) y la materia prima vuelve al costo del snapshot, como una compra a ese costo.

### Fase 2 - Migración `008_recipes_and_production.sql`

| Elemento | Detalle |
| --- | --- |
| `recipes` | `product_id` (FK compuesta con organización), `yield_quantity > 0`, `is_active`, `notes`, `created_by`/`updated_by`, fechas. Índice único parcial `(organization_id, product_id) WHERE is_active`: una receta activa por producto; las inactivas quedan como historial. |
| `recipe_items` | `ingredient_product_id` (FK compuesta), `quantity > 0`, único `(recipe_id, ingredient_product_id)`. |
| `production_runs` | `run_number` (`PROD-000001`, único por organización, vía `production_run_sequences`), producto, receta, depósito, `quantity_produced > 0`, `unit_cost NUMERIC(14,4)`, `total_cost`, `status completed|voided` (CHECK de coherencia con `voided_at`/`voided_by`), snapshots de nombre, unidad y rendimiento, notas, `void_reason`. |
| `production_run_items` | Snapshot de lo consumido: producto, nombre, unidad, cantidad, costo unitario, subtotal. Inmutable (trigger `reject_immutable_row_mutation`). |
| Ledger | `movement_type` suma `production`. `source_type` suma `production_consumption` (delta < 0), `production_output` (> 0) y `production_void` (≠ 0), con `source_id = production_run_id`. Los CHECK se recrean y el trigger de inmutabilidad de 6.1 sigue igual. |
| Idempotencia | `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS` + `ADD`. Se re-ejecutó el SQL completo sobre la base ya migrada sin errores, y los 23 movimientos existentes validan contra los CHECK nuevos. |

### Fase 3 - Backend (`modules/production/`)

- **`/api/recipes`**: `GET` (filtros `status`, `q`, paginado), `GET /:id`, `POST`, `PATCH /:id` (rendimiento, notas, reemplazo de ítems), `PATCH /:id/status`. Valida terminado activo, ingredientes materia prima activa de la organización, cantidades > 0 y sin repetidos (400). Otra organización → 404. Segunda receta activa → 409 `active_recipe_exists`.
- **`/api/production-runs`**: `GET` (filtros `status`, `productId`, `warehouseId`, `from`, `to`, `q`, paginado), `GET /:id`, `POST`, `POST /preview`, `POST /:id/void`.
- **Una sola función de cálculo** (`planProduction`) para la vista previa y el registro: factor = cantidad / rendimiento, consumo redondeado a 3 decimales, subtotal = consumo × costo vigente, costo unitario = total / cantidad y costo resultante ponderado. La vista previa la usa sin bloqueos ni escrituras. El registro la usa con `FOR UPDATE`, así que no pueden divergir.
- **Registrar** (una transacción): asegura que exista el balance del terminado (ver Concurrencia), bloquea balances de ingredientes + terminado en orden, luego la fila de costo del terminado. Valida disponible (cantidad − reservado). Si falta: `409 insufficient_stock` con `shortages[{ productName, unit, requested, available, missing }]`, el mismo formato que Pedidos, sin efectos. Si alcanza: numera, crea la corrida, descuenta cada ingrediente con su movimiento `production_consumption` y `balance_after`, guarda el snapshot, suma el terminado (`production_output`) y actualiza `products.cost`.
- **Anular:** bloquea la corrida (`FOR UPDATE`; segunda anulación → 409 `already_voided`) y los balances. Exige terminado disponible ≥ producido (`409 output_not_available` con disponible). Escribe movimientos inversos `production_void`, revierte costos y marca `voided`.
- `GET /api/inventory/movements` acepta `movementType=production` y `sourceReference` devuelve el número de producción.
- Permisos: lectura (incluida la vista previa) `owner|admin|operator|viewer`; escritura `owner|admin|operator`.

### Fase 4 - Frontend

- **Producción** (`features/production/ProductionView.tsx`), con tres zonas:
  - **Producciones:** historial con búsqueda (número/producto), estado y paginado. El detalle muestra el snapshot de ingredientes, costos, usuario y anulación. "Anular producción" pide confirmación inline con motivo opcional (sin `window.confirm`).
  - **Formulario de producción** (acción primaria "Nueva producción" o "Producir" desde una receta): producto con receta activa, depósito y cantidad. La vista previa viene del endpoint (debounce 350 ms, descarta respuestas viejas): necesario, disponible, estado ("Alcanza" / "Faltan X"), costo unitario, subtotal, costo total, costo por unidad y costo promedio actual → resultante. "Confirmar producción" queda deshabilitado con el motivo visible si falta materia prima. Un 409 por carrera se muestra con el mismo aviso de faltantes.
  - **Recetas:** listado con estado y búsqueda, alta/edición (terminado, rendimiento, notas, ingredientes con unidad, marca de "Ingrediente repetido"), activar/inactivar y detalle con costo vigente de cada ingrediente.
- **Stock:** los movimientos de producción se ven como "Producción · consumo / salida / anulada", con el número `PROD-…` como origen, y el filtro "Tipo" suma "Producción".
- Viewer: "Solo lectura" en ambos paneles, acción primaria deshabilitada, sin anular/editar/producir. Estados cargando/vacío/error con "Reintentar" (`LoadErrorState`) y tablas dentro de `TableScroll`.

### Verificación

- `npm run db:migrate` (aplicó 008), `backend npm run build` y `frontend npm run build` sin errores (JS 289 kB / 77 kB gzip). `/health` y `/ready` → 200.
- **E2E vía API contra PostgreSQL** (script fuera del repo). Números calculados antes de ejecutar:

| Paso | Esperado | Resultado |
| --- | --- | --- |
| Compra 100 kg papa cruda a 5.000 | q=100, costo 5.000 | OK |
| Receta "Papa pelada" rinde 8 kg con 10 kg de papa; vista previa de 16 kg | consume 20 kg, total 100.000, unitario 6.250, resultante 6.250; sin escribir nada | OK |
| Producir 16 kg (`PROD-000001`) | papa 80, papa pelada 16 a 6.250; movimientos −20 (saldo 80) y +16 (saldo 16) con referencia `PROD-000001` | OK |
| Compra 40 kg a 6.000 | papa 120, costo (80×5.000 + 240.000)/120 = 5.333,33 | OK |
| Producir 8 kg (`PROD-000002`) | 10 kg × 5.333,33 = 53.333,30; unitario 6.666,6625; papa pelada (16×6.250 + 53.333,30)/24 = **6.388,89**; el costo de la papa no cambia | OK |
| Salsa criolla (rinde 5: cebolla 4 + aceite 0,5), producir 2,5 kg | cebolla 2 (8.000) + aceite 0,25 (5.000) = 13.000, unitario 5.200 | OK |
| Salsa 15 kg con 8 kg de cebolla | 409, solo cebolla: necesario 12, disponible 8, faltan 4; balances, movimientos, corridas y costos idénticos | OK |
| Pedido 10 kg de papa pelada → confirmar → entregar | reserva 10 (q 24, d 14) → q 14; Ventas 150.000 | OK |
| Anular `PROD-000001` con 5 kg reservados por otro pedido | 409 `output_not_available`, disponible 9 < 16, sin cambios | OK |
| Anular `PROD-000002` | papa pelada 14 → 6, costo (14×6.388,89 − 53.333,30)/6 = **6.018,53**; papa 110 → 120, costo 5.333,33; 2 movimientos `production_void` | OK |
| Editar la receta después de producir | el snapshot de la corrida no cambia | OK |

- **Negativos:** materia prima insuficiente (409 sin parciales), ingrediente terminado (400), receta de una materia prima (400), ingrediente duplicado al crear y al editar (400), rendimiento 0 / cantidad negativa (400), segunda receta activa (409), producto sin receta activa o con receta inactiva (400 `recipe_required`), producir una materia prima (400), depósito de otra organización (404), producto/receta/corrida de otra organización (404, también al editar y anular), cantidad 0 o negativa (400), viewer crea receta / produce / anula (403) y lee recetas, producciones y vista previa (200), UPDATE/DELETE sobre `inventory_movements` y `production_run_items` (rechazados por trigger), anular con terminado vendido/reservado (409), anular dos veces (409).
- **Concurrencia:** 10 producciones simultáneas de 7 kg con 50 kg de harina → 7 × 201 y 3 × 409; harina 1, masa 49, números `PROD-…` sin duplicados. La misma anulación dos veces en paralelo → 200 + 409. **Hallazgo y corrección:** en una segunda corrida aparecieron 2 × 500 por *deadlock*. Cuando el terminado todavía no tenía balance, la primera transacción lo creaba a mitad de camino y las siguientes lo bloqueaban en otro orden que las que ya esperaban. El stock no quedó inconsistente, pero la respuesta era 500. Ahora el registro inserta el balance del terminado con cantidad 0 (`ON CONFLICT DO NOTHING`) **antes** de bloquear; si la producción falla, el rollback lo descarta. Se sumó una prueba de estrés: 5 rondas × 10 producciones paralelas, cada una con un terminado nuevo sin balance (100 kg / 3 kg → 33 × 201, 17 × 409, 0 × 500, azúcar 1) y 0 *deadlocks* en el log de PostgreSQL. **Segundo hallazgo y corrección:** al re-ejecutar, la API quedó colgada (sin responder ni `/ready`), con las 10 conexiones del pool `idle` después de `COMMIT`. Era agotamiento del pool en Node: cada handler releía la corrida o receta con `pool.query` **antes** de liberar su `client`, así que con ≥ 10 requests concurrentes todos retenían una conexión esperando otra. Ahora esas lecturas usan el mismo `client` (commit `5758ab1`). Resultado final: **3 corridas seguidas de 79/79 OK** (escenario completo + estrés), 0 *deadlocks* y 0 respuestas 500.
- **Compatibilidad:** compras (201, costo ponderado igual), ajustes (201), `GET /api/inventory/adjustments`, filtro de movimientos `sale`, flujo de pedidos con reserva/entrega y Ventas sin cambios. **Consistencia global:** suma de movimientos = `quantity` en todos los balances de la base y sin stock negativo.
- **UI (Playwright 1.55, Chromium) - 38/38 OK** con la org `Restaurante Demo 6.2`: historial con 5 producciones (una anulada); detalle con snapshot; alta de receta por UI (el duplicado se marca y se rechaza); formulario con faltante (Milanesa 10 kg: "Faltan 6,3 kg" de carne, confirmar deshabilitado con motivo); vista previa de 1 kg = Gs. 51.900 (1,1×45.000 + 2×900 + 0,2×3.000); producción `PROD-000006` registrada y anulada por UI; Stock con etiquetas de producción y sin UUID. Sin scroll horizontal de página a 1440/1024/390 (Producción, detalle, formulario con faltante, formulario de receta, Stock), sin errores de consola, sin diálogos nativos y sin emails en pantalla. Viewer: sin botones de escritura y acción primaria deshabilitada.
- **Screenshots** en `docs/visual-qa/6.2/` (10 PNG, 0,7 MB): `produccion-historial-1440/390`, `produccion-recetas-1440`, `produccion-form-error-1440/390`, `produccion-detalle-1440`, `stock-movimientos-produccion-1440/390`, `viewer-produccion-1440`, `viewer-stock-1440`.

### Estado y pendientes

- Anulación incluida en esta misión (no hizo falta 6.2b).
- El formulario de producción toma por defecto el primer depósito activo (orden alfabético), igual que Compras. Si hay varios depósitos conviene revisarlo antes de confirmar; la vista previa muestra el depósito elegido.
- A 390 px, las columnas de costo de la vista previa quedan a la derecha del scroll de la tabla (mismo patrón que el resto). El total, el costo por unidad y el costo resultante se ven debajo, sin scroll.
- `PATCH /products` sigue permitiendo cambiar el tipo de un producto usado en recetas. La producción lo detecta y bloquea (400); se podría impedir en Productos si molesta.
- **Riesgo preexistente detectado (no corregido, fuera de alcance):** Pedidos (`POST /`, `PATCH /:id`, `PATCH /:id/status`) y Compras (`POST /`) también releen con `pool.query` antes de liberar el `client`. Con 10 o más requests concurrentes de escritura pueden colgar la API igual que Producción. La corrección es la misma: usar `client` en `getOrderById`/`getPurchaseById` dentro de la transacción. Además, Compras con varias filas de balance creadas a mitad de transacción podría tener el mismo patrón de *deadlock*. Recomendado como hallazgo prioritario para la próxima misión.
- Fuera de alcance (sin cambios): mermas (6.3, incluida la merma de producción real vs. teórica), lotes y vencimientos, subrecetas, conversiones de unidad, mano de obra/indirectos, producción automática por pedido, ecommerce público, mojibake, H7/H8/H9.

## Misión 6.1 - Stock real: movimientos inmutables, reserva y descuento por pedidos

Conecta Pedidos con Inventario. Todo cambio de stock (compras, ajustes, ventas) queda en un ledger inmutable. Confirmar un pedido reserva stock, entregarlo lo descuenta y cancelarlo libera la reserva.

### Fase 0 - H18 (commit `ac191d7`)

- La vista activa se monta con `key={organizationId}` en `app/App.tsx`. Al cambiar de organización se descarta el estado local (depósito, filtros, páginas) de cualquier vista, no solo de Stock. También se reinician los contadores de acción primaria, para que el re-montaje no reabra formularios.
- Verificación con 2 orgs (Playwright, usuario operator en la segunda). **Sin el fix:** 3 × 404 (`/api/inventory` ×2 y `/api/inventory/adjustments` con el depósito de la org anterior). **Con el fix:** 0 respuestas ≥ 400 y el selector muestra el depósito de la org nueva.

### Fase 1 - Auditoría (antes de escribir código)

1. No existía `inventory_movements`. El ledger de hecho era `inventory_adjustments` (003): `previous_quantity`, `new_quantity`, `delta` con CHECK, `reason`, usuario. La 004 agregó `source_type IN ('manual','purchase')` y `purchase_order_id`.
2. Compras y ajustes manuales ya escribían en esa tabla (compras: una fila por producto agregado, `reason='purchase:<id>'`). No era inmutable.
3. Datos existentes consistentes: 8 filas (4 de compra), 6 balances, suma de deltas = `quantity` en todos y cadena previous→new sin huecos.
4. `inventory_balances` sin noción de reserva. Inactivar un depósito solo exige `quantity = 0`.
5. `is_sellable` no depende de `product_type`: hay `raw_material` vendibles (caso Papa/Cebolla de 5.2). Compras solo acepta `raw_material`; un `finished_product` solo recibe stock por ajuste manual (producción fuera de alcance). El corte es precio + snapshot: el descuento va al `product_id` del ítem.
6. Contradicciones con el plan y cómo se resolvieron:
   - **Ítems editables en `confirmed`** (5.2): editar un pedido confirmado libera la reserva vieja y reserva la nueva en la misma transacción; si falta stock, 409 sin cambios.
   - **Datos previos a 6.1:** había 5 pedidos `delivered` que nunca descontaron stock y 1 `confirmed` sin depósito. No se generaron movimientos de venta retroactivos, porque descontar ahora falsearía balances que ya reflejan la realidad. Un pedido sin depósito no avanza a `preparing`, `ready` ni `delivered` hasta elegir uno, y en ese momento reserva igual que al confirmar.
   - **Ajuste manual por debajo de lo reservado:** se bloquea con 409.
   - `inventory_adjustments` se mantiene como documento del ajuste (motivo) y por compatibilidad de `GET /api/inventory/adjustments`. El ledger lo referencia por `source_id`.

### Fase 2 - Migración `007_inventory_movements_and_reservations.sql`

| Elemento | Detalle |
| --- | --- |
| `inventory_movements` | `organization_id`, `warehouse_id`, `product_id`, `movement_type` (`purchase`/`adjustment`/`sale`), `quantity_delta` con signo (CHECK por tipo: compra > 0, venta < 0), `balance_after >= 0`, `source_type` (`purchase`/`adjustment`/`order_delivery`, CHECK de coherencia con el tipo), `source_id`, `created_by`, `created_at`. FKs compuestas `(id, organization_id)` a depósito y producto. Único `(source_type, source_id, warehouse_id, product_id)`: hace idempotente el backfill e impide descontar dos veces una entrega. |
| Inmutabilidad | Trigger `BEFORE UPDATE OR DELETE` (por fila) y `BEFORE TRUNCATE` que lanza `inventory_movements es inmutable`. Además `REVOKE UPDATE, DELETE, TRUNCATE ... FROM PUBLIC`. Las correcciones son movimientos nuevos (ajustes). |
| Backfill | Desde `inventory_adjustments`: `manual` → `adjustment` (`source_id` = id del ajuste), `purchase` → `purchase` (`source_id` = `purchase_order_id`), `balance_after = new_quantity`. `ON CONFLICT DO NOTHING`. Resultado sobre la base existente: 8 movimientos (4 compras +88, 4 ajustes, neto 0) y 0 balances con diferencia entre `quantity` y la suma de movimientos. |
| Reservas | `inventory_balances.reserved_quantity` con `CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity)`; disponible = `quantity − reserved_quantity`. Se eligió sobre una tabla `stock_reservations` porque se bloquea una sola fila por producto, el disponible es una columna y la propia base impide la sobreventa. El detalle por pedido se deriva de `order_items` + estado + `orders.warehouse_id`, sin una tabla extra que mantener sincronizada (incluida la edición de ítems). |
| Pedidos | `orders.warehouse_id` (nullable hasta confirmar, FK `(warehouse_id, organization_id)` → aislamiento por organización) y `orders.delivered_at` (base de Ventas; backfill desde `order_status_history` para los entregados previos). |
| Idempotencia | `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS` / constraints en bloques `DO`. Se re-ejecutó el SQL completo sobre la base ya migrada: sin errores y sin duplicar movimientos. Antes de migrar se tomó un `pg_dump` (fuera del repo). |

### Fase 3 - Reglas en backend

- Módulo compartido `modules/inventory/stock-ledger.ts`: `lockBalances` (`SELECT ... FOR UPDATE` ordenado por `product_id`, mismo orden que compras para evitar deadlocks), `reserveStock` (todo o nada), `releaseStock`, `consumeReservedStock`, `recordMovement`.
- `PATCH /api/orders/:id/status` acepta `warehouseId` opcional. Todo ocurre en una transacción, junto con el historial de estados:
  - **Confirmar** (o avanzar un pedido sin depósito): exige `warehouseId` (`400 warehouse_required`). El depósito debe ser de la organización (404) y estar activo (400). Bloquea los balances y valida disponible ≥ cantidad agregada por producto (un mismo producto con dos cortes suma). Si falta stock: `409 { code: 'insufficient_stock', warehouseName, shortages: [{ productName, unit, requested, available, missing }] }`, sin reservas parciales. Un producto sin balance en el depósito cuenta con disponible 0.
  - **Entregar:** baja `quantity` y `reserved_quantity` y escribe un movimiento `sale` (`order_delivery`) con delta negativo y `balance_after`. Fija `delivered_at`.
  - **Cancelar** (desde `confirmed`/`preparing`/`ready`): libera la reserva y no genera movimientos.
  - Un pedido con reserva no puede cambiar de depósito (400); hay que cancelarlo.
- `PATCH /api/orders/:id` en `confirmed`: re-reserva atómica (409 con faltantes si no alcanza).
- Compras y ajustes escriben movimientos. En compras, `balance_after` sale del `RETURNING` del upsert. Un ajuste por debajo de lo reservado devuelve 409.
- Endpoints: `GET /api/inventory` suma `reservedQuantity` y `availableQuantity`. Nuevo `GET /api/inventory/movements` (filtros `productId`, `warehouseId`, `movementType`, `from`, `to`, paginado; `sourceReference` = factura, número de pedido o motivo del ajuste). Nuevo `GET /api/sales` (pedidos `delivered` por `delivered_at`, con `summary { count, total }`). Pedidos (listado y detalle) suman `warehouseId`, `warehouseName` y `deliveredAt`. El resto de los contratos no cambia.

### Fase 4 - Frontend

- **Stock:** columnas Cantidad / Reservado / Disponible. El panel "Movimientos de stock" (ledger, con filtros producto/tipo/fechas y estados cargando/vacío/error) reemplaza a "Historial de ajustes": los ajustes siguen ahí con su motivo, y las compras muestran el número de factura en vez de `purchase:<uuid>` (cierra H11). El formulario de ajuste muestra el mínimo reservado.
- **Pedidos:** selector "Deposito de despacho" cuando el pedido no tiene depósito. El 409 se muestra como aviso (`role="alert"`) con producto, pedido, disponible y faltante. Depósito en el listado y en el detalle, y fecha de entrega en el detalle. Al editar un confirmado se avisa que se ajusta la reserva.
- **Ventas:** listado de solo lectura de pedidos entregados con período (por defecto, el mes actual), búsqueda, total vendido y cantidad. La acción primaria pasa a "Nuevo pedido" (no hay ventas manuales).
- **Dashboard:** "Facturación del mes" = suma real de pedidos entregados desde el 1° del mes (hora local). Mermas y alertas siguen en "Sin datos todavía".
- Sin `window.alert` (Playwright no registró ningún diálogo). El viewer ve "Solo lectura", sin selector de depósito ni botones de transición.

### Verificación

- `npm run db:migrate` (aplicó 007), `backend npm run build` y `frontend npm run build` sin errores (JS 262 kB / 71 kB gzip).
- **Flujo real contra PostgreSQL** (script E2E vía API, **46/46 OK**):

| Paso | Esperado | Resultado |
| --- | --- | --- |
| Compra 100 kg Papa + 20 kg Cebolla en Central | Papa q=100 r=0 d=100; movimiento `purchase` +100, saldo 100, referencia = factura | OK |
| Pedido Papa 30 + Cebolla 5 (en `new`) | Sin reserva | OK |
| Confirmar en Central | Papa q=100 r=30 d=70 | OK |
| `preparing` → `ready` → `delivered` | Papa q=70 r=0; Cebolla q=15; movimiento `sale` −30 con saldo 70 y número de pedido | OK |
| Otro pedido Papa 10: confirmar → preparar → cancelar | r 10 → 0, q=70 intacta, sin movimiento nuevo | OK |
| Editar un confirmado 10 → 60 kg / 60 → 100 kg | r=60 / 409 sin cambios en reserva ni ítems | OK |
| Ajuste a 50 con 60 reservados / ajuste 70 → 75 | 409 / movimiento `adjustment` +5, saldo 75, referencia = motivo | OK |
| Ventas | 1 pedido, total = total del pedido entregado (Gs. 170.000) | OK |
| Consistencia global | Suma de movimientos = `quantity` en todos los balances de la base | OK (0 diferencias) |

- **Negativos:** stock insuficiente (Papa 80 con 70 disponibles → 409 con faltan 10; la Cebolla del mismo pedido no quedó reservada; el pedido sigue `new` y sin depósito); depósito de otra org → 404; producto sin balance → 409 con disponible 0; depósito sin stock → 409; confirmar sin depósito → 400 `warehouse_required`; pedido previo a 6.1 (`confirmed` sin depósito) → `preparing` exige depósito y luego reserva; viewer cambia estado o ajusta → 403, lee inventario y movimientos → 200; otra org: pedido → 404, movimientos de depósito ajeno → 404, listado de movimientos vacío, confirmar pedido ajeno → 404; `UPDATE` y `DELETE` sobre `inventory_movements` → rechazados por el trigger (también `TRUNCATE`, probado por psql).
- **Concurrencia:** 10 confirmaciones simultáneas de 10 kg con 75 disponibles → 7 × 200, 3 × 409, reservado 70, disponible 5 (sin sobreventa). El mismo pedido confirmado dos veces en paralelo → 200 + 400 (transición inválida) y una sola reserva.
- **Compatibilidad:** compras y ajustes siguen respondiendo igual (201) y ahora generan movimientos; `GET /api/inventory/adjustments` sin cambios; `/health` y `/ready` en 200.
- **UI (Playwright 1.55, Chromium):** confirmar con faltantes muestra el aviso (Papa: faltan 20 kg; Milanesa de carne: faltan 2 kg), y confirmar con stock muestra "Stock reservado en Depósito Central". Sin scroll horizontal de página en Pedidos (también con el detalle abierto), Stock, Ventas y Dashboard a 1440/1024/390 (las tablas anchas scrollean dentro de `TableScroll`). Sin errores de consola (salvo el 409 esperado), sin diálogos y sin emails en pantalla.
- **Screenshots** en `docs/visual-qa/6.1/` (11 PNG, 0.9 MB), con datos de la org `Restaurante Demo 6.1` (usuarios con nombre, sin emails ni credenciales): `stock-1440/390`, `pedidos-confirmar-error-1440/390`, `pedidos-confirmado-1440`, `ventas-1440/390`, `dashboard-1440/390`, `viewer-stock-1440`, `viewer-pedido-detalle-1440`.

### Estado y pendientes

- H18 cerrado (también se cierra H11). Pendientes de 5.3: H5, H7–H10, H12–H17.
- A 390 px, las columnas Reservado/Disponible de Stock quedan a la derecha del scroll de la tabla. Es el mismo patrón que el resto de las tablas; podría priorizarse una vista en tarjetas si el uso móvil es frecuente.
- Fuera de alcance (sin cambios): producción, mermas, lotes/vencimientos, mínimos y alertas, transferencias, pedidos multi-depósito, pagos/facturación, ecommerce público.

## Misión 5.4 - Endurecimiento de UX (H2, H3, H4, H6)

Cierra los hallazgos de mayor impacto de la verificación 5.3, sin rediseño ni features nuevas.

### Fase 0 - Commit de 5.3

- `git diff --stat app.css`: 1 línea (sin problema CRLF/LF; `core.autocrlf=true` ya estaba configurado).
- Doc sin credenciales (solo placeholders `<ts>`). En las capturas, `miembros-*`, `vacio-miembros-1440` y `login-error-1440` mostraban emails de prueba; se volvieron a tomar con esos campos enmascarados.
- `docs/visual-qa`: 4.6 MB, no hizo falta optimizar.
- Commits `ebc47ed` (fix del sidebar) y `a3c30e0` (docs 5.3). Se eliminó un `.git/index.lock` huérfano (0 bytes, de antes de la sesión, sin procesos git activos).

### Cambios

| Hallazgo | Cambio | Archivos |
| --- | --- | --- |
| H3 - Dashboard con cifras inventadas | Se quitaron todos los valores fijos (KPIs de facturación, gráficos de ejemplo y alertas ficticias). Ahora muestra solo datos reales tomados de `pagination.total` de endpoints existentes: productos activos, clientes activos, pedidos abiertos (`new` + `confirmed` + `preparing` + `ready`) y compras del mes. Suma un panel "Pedidos por estado" (6 estados) y "Compras recientes" (últimas 5, o "Sin compras registradas todavía."). Facturación, mermas y alertas muestran "Sin datos todavía". Tiene estados de carga y de error con reintento. En una organización vacía todo queda en 0. | `features/dashboard/DashboardView.tsx`, `app/App.tsx`, `app.css` |
| H4 - `window.alert` "pendiente" | Se eliminó el `window.alert`. La acción primaria solo está habilitada en las secciones con flujo real (Productos, Tipos de corte, Clientes, Pedidos, Compras, Stock). En Dashboard, Producción, Mermas, Ventas y Miembros queda deshabilitada con el motivo "Próximamente"; para `viewer` en los módulos reales, con "Requiere permisos de owner, admin u operator.". El motivo ahora es **visible** junto al botón (`.topbar__action-hint`, enlazado con `aria-describedby`), además del `title`. | `app/App.tsx`, `app/components/SystemShell.tsx`, `app.css` |
| H2 - desborde de tablas | Nuevo componente compartido `TableScroll` (`.table-scroll { overflow-x: auto }`) que envuelve las 14 tablas (Productos, Categorías, Cortes de producto, Tipos de corte, Clientes, Pedidos ×2, Compras ×3, Stock ×3, Miembros, Dashboard). Causa raíz adicional: las páginas son grids y `.panel` crecía hasta el ancho de la tabla; se resolvió con `.panel { min-width: 0 }`. `.topbar` y `.topbar__actions` pasan a `flex-wrap`. La fila de ítem de pedido pasa a 3 columnas en ≤1050px (antes desbordaba a 1024px con el formulario abierto). En ≤760px, `.shell` usa `grid-template-rows: auto 1fr` para que el sidebar no se estire en pantallas cortas. | `shared/components/TableScroll.tsx`, 9 vistas, `app.css` |
| H6 - error de carga mostrado como lista vacía | Nuevo componente compartido `LoadErrorState` (mensaje claro, botón "Reintentar", `role="alert"` + `aria-live`). Cada listado tiene un estado `loadError` separado del `errorMessage` de las mutaciones. Si falla la carga se ocultan el total, la tabla, el estado vacío y la paginación, y el error aparece dentro del panel. Aplicado a Productos, Clientes, Pedidos, Compras (compras y proveedores), Stock (depósitos, inventario e historial de ajustes) y Dashboard. Ya no se muestra el mensaje crudo de la API en errores de carga. | `shared/components/LoadErrorState.tsx`, vistas citadas |

Quedan `window.confirm` solo como confirmación de acciones destructivas (inactivar, cancelar pedido), un patrón previo que no es de "pendiente".

### Verificación

- Builds: `backend npm run build` OK; `frontend npm run build` OK (JS 253.52 kB / 69.44 kB gzip, CSS 15.87 kB).
- Desborde: `scrollWidth <= clientWidth` en las 11 secciones a 1024 y 390 px, y también con estados abiertos (detalle de pedido, formulario de pedido, edición de producto con cortes, formulario de compra). Antes de 5.4: Productos 1.095px a 1024; a 390 entre 472 y 774px.
- Errores simulados (500 interceptado) en Productos, Clientes, Pedidos, Compras, Stock y Dashboard: muestran el error en el panel sin "Total"; "Reintentar" vuelve a pedir los datos y la tabla reaparece (por ejemplo, Productos 10 filas, Pedidos 5).
- Viewer (`Demo QA`): botón primario deshabilitado en todas las secciones, con "Requiere permisos…" en los módulos reales y "Próximamente" en el resto; "Miembros" sigue oculto.
- Consola/red: sin errores salvo los 500 simulados y el caso preexistente H18.
- Screenshots en `docs/visual-qa/5.4/` (43 PNG, 2.8 MB): secciones afectadas en 1440/1024/390; `dashboard-antes-1440` vs `dashboard-1440`; `productos-error-antes-1440` vs `productos-error-1440` / `-390`; `*-error-1440`; `dashboard-org-vacia-1440`; `viewer-*-1440`; estados abiertos a 390.

### Hallazgo nuevo

| # | Prioridad | Tipo | Pantalla | Archivo | Hallazgo |
| --- | --- | --- | --- | --- | --- |
| H18 | Media · **Resuelto en 6.1** | Bug | Stock | `features/stock/StockView.tsx` | Si se cambia de organización con Stock abierto, la vista conserva el `selectedWarehouseId` de la org anterior y pide `/api/inventory?warehouseId=<otro>` → 404 (inventario y ajustes). Es preexistente; con 5.4 se ve como error con "Reintentar", que repite el 404 hasta que se recarga la sección. Propuesta: reiniciar el depósito seleccionado al cambiar `token`/organización. |

### Estado

H2, H3, H4 y H6 cerrados. Pendientes: H5, H7–H17 y H18.

## Misión 5.3 - Entorno local y verificación visual completa

Cierra el pendiente de 5.2 ("validación visual interactiva con screenshot"). Sin rediseños ni features nuevas.

### Cómo se levantó el entorno

| Paso | Resultado |
| --- | --- |
| `backend/.env`, `frontend/.env` | Ya existían (ignorados por git). `DATABASE_URL` ya apuntaba a `gastronexo:gastronexo-dev@localhost:5432/gastronexo_dev` (Docker). `JWT_SECRET` de 55 caracteres. Se corrigió `FRONTEND_ORIGIN` de `http://localhost:5175` a `http://localhost:5173` (con 5175 el CORS bloquearía al front en 5173). |
| PostgreSQL | No hay PostgreSQL instalado en Windows (ni servicio ni binarios). Docker Desktop estaba detenido (pipe `dockerDesktopLinuxEngine` inexistente); se arrancó `Docker Desktop.exe` y el engine respondió en ~1 min. El contenedor `gastronexo-postgres` ya existía y arrancó por `restart: unless-stopped` (`healthy`). `docker compose up -d postgres` devolvió un error 500 al consultar la imagen, pero no fue necesario. |
| `npm install` + `npm run db:migrate` | Sin cambios de dependencias; migraciones 001 a 006 ya aplicadas (`schema_migrations` con 6 filas), el migrador terminó sin pendientes. |
| `npm run dev` (backend) | `GET /health` → `200 {"status":"ok"}`; `GET /ready` → `200 {"status":"ready"}`. |
| `npm run dev` (frontend) | Vite 5.4.21 arrancó en `http://localhost:5173` (`--strictPort`) **sin `spawn EPERM`**. No hizo falta el fallback `build + preview` ni servir `dist/`. |
| Navegador | Chromium headless vía Playwright 1.55 (instalado fuera del repo, en un directorio temporal) usando el Chromium ya cacheado en `%LOCALAPPDATA%\ms-playwright`. |
| Builds | `backend: npm run build` (tsc) OK. `frontend: npm run build` (tsc -b + vite build) OK: JS 251.94 kB (69.04 kB gzip), CSS 15.27 kB. |

### Datos de prueba (vía API)

- Owner `owner-<ts>@demo.local` con organización `Demo QA <ts>`; segundo usuario `viewer-<ts>@demo.local` (registra su propia org `Viewer Org <ts>`, que queda vacía) agregado como `viewer` a `Demo QA`.
- 2 categorías (`Verduras`, `Elaborados`), 1 depósito (`Depósito central`), 1 proveedor.
- 3 materias primas (`Papa negra`, `Cebolla`, `Zanahoria`, en kg).
- 2 productos terminados vendibles: `Papa procesada` (Gs. 5.000/kg, visible en catálogo) y `Cebolla en pluma` (Gs. 4.000/kg, `isCatalogVisible=false`).
- 2 tipos de corte (`Bastón`, `Cubos`): Papa → Bastón (+1.000, default) y Cubos (+0); Cebolla → Cubos (+500, default).
- 1 compra con 2 ítems (50 kg Papa negra, 30 kg Cebolla) → stock 50 / 30 con historial de ajustes.
- 1 cliente (`Restaurante El Fogón`), 3 pedidos: `PED-000001` en `new` (total 82.500), `PED-000002` en `confirmed`, `PED-000003` en `delivered`.

### Screenshots

En `docs/visual-qa/` (69 PNG, ~4.6 MB, página completa). En `miembros-*`, `vacio-miembros-1440` y `login-error-1440` los emails de prueba están enmascarados (bloque magenta):

- `<seccion>-<ancho>.png` para `login`, `dashboard`, `productos`, `tipos-de-corte`, `clientes`, `pedidos`, `compras`, `produccion`, `mermas`, `ventas`, `stock`, `miembros` en 1440, 1024 y 390 px (36 capturas).
- Estados: `login-error-1440`, `productos-cargando-1440`, `productos-error-1440` (500 simulado interceptando la request), `productos-form-validacion-1440`, `vacio-*-1440` (org vacía), `pedidos-dark-1440`, `focus-teclado-1440`.
- Flujos: `flujo-producto-cortes-1440`, `flujo-pedido-form-1440`, `flujo-pedido-historial-1440`.
- Organización y viewer: `selector-organizacion-1440`, `selector-organizacion-cambiada-1440`, `viewer-*-1440`, `viewer-pedido-detalle-1440`, `viewer-productos-cortes-1440`, `viewer-pedidos-390`.

### Flujos de punta a punta

| Flujo | Resultado |
| --- | --- |
| 1. Registro → login → recarga → logout | OK. El registro solo existe por API (no hay UI). Login guarda `gastronexo:auth:token` en `localStorage`; tras `reload` la sesión se restaura (Dashboard); logout limpia el storage y vuelve al login. Contraseña incorrecta muestra "Email o contraseña incorrectos." (`role="alert"`). |
| 2. Producto con categoría, precio y cortes | OK. Alta `Zanahoria rallada QA` (kg, elaborado, Elaborados, costo 1.000, vendible, visible, Gs. 3.500); desde "Editar" se asignan Cubos (+200, default) y Bastón (+0); mensaje "Corte asignado correctamente." |
| 3. Pedido manual | OK. Cliente + Papa procesada/Bastón × 10 + Cebolla en pluma/Cubos × 5: total en formulario **Gs. 82.500** = 10 × (5.000 + 1.000) + 5 × (4.000 + 500); el modificador de corte se aplica por unidad. Se guardó como `PED-000004` con el mismo total. |
| 4. `new → confirmed → preparing → ready → delivered` | OK por UI (Confirmar / Iniciar preparacion / Marcar listo / Entregar). El historial muestra las 5 entradas con usuario y fecha. |
| 5. Viewer | OK. En las 10 secciones visibles no hay botones de escritura habilitados en el contenido; la acción primaria de los módulos reales queda deshabilitada con `title="Requiere permisos de owner, admin u operator."`; "Miembros" no aparece en el menú; el detalle de pedido muestra "Solo lectura"; "Ver cortes" no muestra el formulario de alta. |
| Selector de organización | OK. El viewer ve 2 organizaciones; al cambiar se actualiza el nombre, el token y los permisos (owner en su org → viewer en `Demo QA`). |

### Resultado del checklist

| Ítem | Resultado |
| --- | --- |
| Carga sin errores de consola ni requests fallidas | OK en las 12 pantallas × 3 anchos. Solo aparecieron el `401` esperado del login fallido y los `500` simulados a propósito. |
| Sidebar/topbar y sección activa | OK: `.nav__item--active` correcto en todas las pantallas. En ≤760px el sidebar desbordaba la página (corregido, ver abajo). |
| Tablas sin desborde horizontal en móvil | **Falla parcial**: ver hallazgo H2. |
| Estados vacío / cargando / error | Vacío y cargando: textos claros ("No hay pedidos para los filtros seleccionados.", "Cargando productos..."). Error: ver H6. |
| Formularios: labels, validaciones, errores | Todos los campos tienen `<label>` visible. La validación nativa `required` se dispara antes que los mensajes propios (H8). |
| Acción primaria / viewer | OK en los módulos reales. En placeholders y Dashboard está habilitada incluso para viewer y abre un `window.alert` (H4). |
| Mojibake | En la UI renderizada no se detectó (búsqueda automática de `Ã`, `Â`, `â€`, `�` en las 69 pantallas). En el código: 1 caso en un mensaje de la API (H15). Hay textos sin tilde (H16). |
| Foco por teclado y contraste | El foco es visible pero es el anillo por defecto del navegador (1px); solo `.field input:focus` tiene estilo propio (H9). Contraste de texto y badges razonable en claro y oscuro. |
| Placeholders (Producción, Mermas, Ventas, Dashboard) | Visualmente coherentes con el sistema (Panel, iconos, badges). Contenido engañoso: ver H3 y H5. |

### Bug corregido

- **H1 · Móvil (≤760px): el sidebar estiraba toda la página a ~1.212px de ancho.** La acción primaria y el logout quedaban fuera de pantalla en todas las secciones. Causa: `.shell { grid-template-columns: 1fr }`; el mínimo de `1fr` es el ancho del contenido, así que el `overflow-x: auto` de `.nav` nunca se activaba. Corrección: `minmax(0, 1fr)` en `frontend/src/shared/styles/app.css`. Después del cambio Dashboard, Tipos de corte, Mermas, Ventas y Login no tienen desborde en 390px, y el menú scrollea horizontalmente.

### Hallazgos priorizados (pendientes para una misión aparte)

| # | Prioridad | Tipo | Pantalla | Archivo | Hallazgo |
| --- | --- | --- | --- | --- | --- |
| H2 | Alta · **Resuelto en 5.4** | UX/bug | Productos (1024 y 390), Pedidos, Stock, Compras, Clientes, Miembros, Producción (390) | `app.css` (`.panel__body`, `.topbar__actions`) | Las tablas no tienen contenedor con scroll y desbordan la página: Productos 1.095px a 1024 de ancho y 774px a 390; Pedidos/Stock 630px; Compras 545px; Clientes 510px; Miembros 472px; Producción 405px (por la topbar). Propuesta: `overflow-x: auto` en el contenedor de las tablas y `flex-wrap` en `.topbar__actions`. |
| H3 | Alta · **Resuelto en 5.4** | UX | Dashboard | `features/dashboard/DashboardView.tsx` | Muestra métricas ficticias fijas (Gs. 1.850.000, "6 insumos alcanzaron su punto de reposición", etc.) también en una organización vacía. Se pueden confundir con datos reales. |
| H4 | Alta · **Resuelto en 5.4** | UX | Dashboard, Producción, Mermas, Ventas, Miembros | `app/App.tsx:326` | La acción primaria ("Ver reporte", "Nueva producción", "Registrar merma", "Registrar venta", "Gestionar accesos") está habilitada, incluso para viewer, y abre `window.alert("… flujo pendiente de implementación.")`. |
| H5 | Media | UX/texto | Producción, Mermas, Ventas | `features/shared/PlaceholderModule.tsx:36` | Un badge verde dice "Base funcional lista" en módulos sin funcionalidad. |
| H6 | Media · **Resuelto en 5.4** | UX | Productos (patrón compartido) | `features/products/ProductsView.tsx:406` | Con error de carga, el catálogo muestra "Total: 0 / Página 1 de 1" como si estuviera vacío. El error aparece al pie de la página, lejos de la tabla, sin opción de reintentar y con el mensaje de la API tal cual. |
| H7 | Media | UX | Login | `app/components/LoginView.tsx` | No hay UI de registro ni de creación de organización; solo se puede por API. |
| H8 | Media | UX/texto | Formularios (Productos, Login, Pedidos) | `features/products/ProductForm.tsx` | Los atributos `required` nativos muestran el globo del navegador en el idioma del navegador ("Please fill out this field.") antes que los mensajes propios `.form-error`. |
| H9 | Media | a11y | Todas | `shared/styles/app.css:65` | Falta un estilo `:focus-visible` propio para botones, ítems de navegación y selects; solo los inputs de `.field` tienen anillo de foco con la marca. |
| H10 | Media | a11y | Topbar (todas) | `app/components/SystemShell.tsx` | Hay dos `h1` por pantalla (topbar y página) con el mismo texto. El `select` de organización no tiene `<label>` asociado. El nombre de la organización se repite (select y span). La navegación no usa `aria-current`. |
| H11 | Baja · **Resuelto en 6.1** | UX | Stock › Historial de ajustes | `features/stock/StockView.tsx` | La columna "Motivo" muestra el valor crudo `purchase:<uuid>`. |
| H12 | Baja | UI | Productos, Categorías | `app.css:516` | `td.products-table__actions` usa `display: flex`, por eso el borde inferior de la columna Acciones queda desalineado con el resto de la fila. |
| H13 | Baja | Dominio | Productos | `backend/src/modules/products/products.routes.ts` | Se permiten productos activos con nombre duplicado (se crearon dos "Zanahoria rallada QA 7716"). Confirmar si es intencional. |
| H14 | Baja | Texto | Varias | — | Se mezcla tuteo y voseo: "Gestiona pedidos…" (Pedidos) frente a "Gestioná productos…" (Productos, Stock, Miembros). |
| H15 | Baja | Mojibake | Compras (error de API) | `backend/src/modules/purchases/purchases.routes.ts:334` | "No se puede registrar una compra en un depÃ³sito inactivo." |
| H16 | Baja | Texto | Pedidos, Clientes | `features/orders/OrdersView.tsx`, `features/customers/CustomersView.tsx` | Faltan tildes: "En preparacion", "Iniciar preparacion", "Numero", "Buscar por numero", "Razon social", "Telefono", "Pagina", "Items". Los mensajes de la API también tienen textos sin tilde ("catalogo"). |
| H17 | Baja | Texto | Montos (todas) | formateadores `es-PY` | La moneda se muestra como guaraníes ("Gs.") y los textos usan voseo rioplatense. Confirmar la moneda objetivo con el cliente. |

### Estado y pendientes

- Entorno: backend y frontend corriendo, `/health` y `/ready` en 200, builds OK.
- Verificación visual: 11 secciones + login + selector de organización en 3 anchos, con screenshots; flujo de pedido completo validado por UI.
- Pendiente: H2 a H17 en una misión de pulido UI/UX. H2 es el que más afecta en móvil.

## Mision 5.2 - Motor administrativo de pedidos

### Alcance implementado

- Clientes: modelo minimo por organizacion con alta, edicion, activacion/inactivacion, listado, detalle y permisos de solo lectura para `viewer`.
- Pedidos: cabecera operativa con `order_number` legible (`PED-000001` por organizacion), cliente, fechas, notas, estado, subtotal, total y usuario creador.
- Items de pedido: productos vendibles con corte opcional/validado, cantidad, precio base congelado, modificador de corte congelado, subtotal y snapshots de nombre/unidad/corte.
- Historial de estados: tabla `order_status_history` con estado origen/destino, usuario y fecha.
- Panel administrativo: navegacion `Clientes` y `Pedidos`, listado filtrable, formulario de pedido manual, detalle, acciones por estado y bloqueo de escritura para `viewer`.

### Decisiones de dominio

- Pedidos son dominio central compartido por administracion y el futuro ecommerce; el ecommerce futuro debe consumir este mismo backend.
- El motor de pedido vive en backend y no depende de logica del frontend para precios, cortes ni transiciones.
- `order_items` congela `unit_price`, `cut_price_modifier`, `subtotal`, nombre/unidad de producto y nombre de corte para preservar historico ante cambios comerciales posteriores.
- `is_catalog_visible` no es requisito para pedidos administrativos: un producto puede venderse internamente aunque este oculto en ecommerce.
- Crear o editar pedidos no reserva ni descuenta inventario en Mision 5.2.
- Los pedidos `new` y `confirmed` pueden editar datos/items; `preparing`, `ready`, `delivered` y `cancelled` no permiten editar items.

### Estados y transiciones

- `new -> confirmed | cancelled`
- `confirmed -> preparing | cancelled`
- `preparing -> ready | cancelled`
- `ready -> delivered`
- `delivered` y `cancelled` son terminales para esta etapa.

### Endpoints incorporados

- Clientes (`/api/customers`):
  - `GET ?status=active|inactive|all&q=&page=&pageSize=`
  - `GET /:id`
  - `POST`
  - `PATCH /:id`
  - `PATCH /:id/status`
- Pedidos (`/api/orders`):
  - `GET ?status=&q=&from=&to=&page=&pageSize=`
  - `GET /:id`
  - `POST`
  - `PATCH /:id`
  - `PATCH /:id/status`

### Validaciones ejecutadas

- `docker compose up -d postgres`: bloqueado por permisos del pipe `dockerDesktopLinuxEngine`.
- PostgreSQL local existente en `localhost:5432`: usado correctamente.
- `cd backend && npm.cmd run db:migrate`: exitoso; aplicada `006_customers_and_orders.sql`.
- `cd backend && npm.cmd run build`: exitoso.
- `cd frontend && npm.cmd run build`: exitoso.
- `/health`: `200 { status: "ok" }`.
- `/ready`: `200 { status: "ready" }`.
- Flujo API real en PostgreSQL:
  - cliente `Restaurante Don Pepe`;
  - producto `Papa 1789246502160`, corte `Baston 1789246502160`, cantidad `10.000`, precio `5000.00`, modificador `1000.00`, subtotal `60000.00`;
  - producto `Cebolla 1789246502160`, corte `Cubos 1789246502160`, cantidad `5.000`, precio `4000.00`, modificador `500.00`, subtotal `22500.00`;
  - total `82500.00`;
  - pedido `PED-000001`;
  - recorrido `new -> confirmed -> preparing -> ready -> delivered`;
  - historial persistido con cinco entradas incluyendo alta inicial.

### Validaciones negativas ejecutadas

- Pedido sin cliente valido: `404`.
- Cliente inactivo: `400`.
- Pedido sin items: `400`.
- Cantidad `0`: `400`.
- Cantidad negativa: `400`.
- Producto no vendible: `400`.
- Producto inactivo: `400`.
- Corte no asociado al producto: `400`.
- Corte inactivo: `400`.
- Recurso de organizacion cruzada: `404`.
- `viewer` creando pedido: `403`.
- `viewer` cambiando estado: `403`.
- Transicion invalida desde `delivered` a `new`: `400`.
- Edicion de pedido entregado: `400`.
- Producto vendible sin precio de venta valido: `400`.

### Compatibilidad validada

- Productos: `GET /api/products` respondio `200`.
- Tipos de corte: `GET /api/cut-types` respondio `200`.
- Inventario: `GET /api/inventory` respondio `200`.
- Compras: `GET /api/purchases` respondio `200`.
- Proveedores: `GET /api/suppliers` respondio `200`.
- Categorias: `GET /api/product-categories` respondio `200`.
- Depositos: `GET /api/warehouses` respondio `200`.
- Se verifico explicitamente que crear el pedido no altero inventario: balances antes `0`, despues `0`, comparacion sin cambios.

### Auditoria visual inicial

- Referencias usadas: `.claude/skills/ui-ux-pro-max`, `.claude/skills/design-system`, `.claude/skills/ui-styling`, `docs/style-guide.md` y `docs/frontend-system-template.md`.
- Pantallas revisadas por codigo/patron: sidebar/topbar, Productos, Tipos de corte, Inventario, Proveedores y Compras.
- Patrones reutilizados: `SystemShell`, `Panel`, `Button`, `StatusBadge`, tablas compactas, filtros con labels visibles, mensajes `aria-live`, confirmacion para acciones destructivas y breakpoints moviles existentes.
- Observacion visual existente: hay mojibake en textos historicos de la UI/documentacion; no se corrigio globalmente para evitar rediseño o churn fuera de alcance.
- Validacion interactiva con navegador no disponible desde Computer Use; Vite dev/preview fallaron por `spawn EPERM`, pero el build de produccion compilo correctamente y se pudo servir `dist` por Python en `http://localhost:5173`.

### Bug corregido

- `GET /api/products` fallaba con `500` por referencia ambigua a `is_active` tras join con categorias.
- Correccion: calificar filtros como `p.is_active` en `products.routes.ts`.

### Estado y pendientes

- Codigo, migracion, frontend, documentacion y pruebas API reales: completados.
- Pendiente real: validacion visual interactiva con screenshot en navegador cuando el entorno permita controlar/abrir browser o cuando Vite no falle por `spawn EPERM`.
- Ecommerce publico, carrito, pagos, reservas/descuentos de stock, direcciones multiples, descuentos, impuestos y precios especiales quedan fuera de alcance.

## Mision 5.1 - Modelo comercial y tipos de corte

### Alcance implementado

- Productos: configuracion comercial minima con `is_sellable`, `is_catalog_visible` y `sale_price`.
- Tipos de corte: entidad reutilizable por organizacion con nombre, descripcion opcional, estado activo/inactivo y unicidad case-insensitive por organizacion.
- Opciones de corte por producto: relacion entre producto base y tipo de corte con estado, default unico activo, modificador de precio preparado y orden.
- Panel administrativo: pantalla especifica de Tipos de corte y gestion de cortes permitidos al editar/consultar un producto.
- Permisos: `owner`, `admin` y `operator` con lectura/escritura; `viewer` en solo lectura.

### Decisiones de dominio

Los tipos de corte son opciones de preparacion asociadas a un producto base, no productos independientes.

El inventario continua perteneciendo al producto base.

- `sale_price` es independiente de `cost`; compras e inventario siguen usando costo/promedio ponderado.
- Un producto visible en catalogo debe ser vendible.
- Un producto inactivo no acepta nueva configuracion comercial ni nuevas opciones de corte.
- `Sin corte` no se asigna automaticamente; queda como opcion configurable por producto.
- Inactivar un tipo de corte global no elimina relaciones historicas con productos.

### Endpoints incorporados

- Tipos de corte (`/api/cut-types`):
  - `GET ?status=active|inactive|all&q=`
  - `POST`
  - `PATCH /:id`
  - `PATCH /:id/status`
- Productos (`/api/products`):
  - `GET/POST/PATCH` y detalle exponen `isSellable`, `isCatalogVisible`, `salePrice`.
  - `GET /:id/cut-options`
  - `POST /:id/cut-options`
  - `PATCH /:id/cut-options/:optionId`

### Validaciones ejecutadas

- `cd backend && npm.cmd run db:migrate`: exitoso; aplicada `005_commercial_products_and_cut_types.sql`.
- `cd backend && npm.cmd run build`: exitoso.
- `cd frontend && npm.cmd run build`: exitoso.
- Flujo API real en PostgreSQL:
  - organizacion A/B;
  - usuario owner y usuario viewer;
  - cortes `Sin corte`, `Baston`, `Juliana`, `Cubos`;
  - productos `Papa Mision 5.1 20260912163958` y `Cebolla Mision 5.1 20260912163958`;
  - Papa vendible/visible con precio `5000.00`, cortes `Sin corte`, `Baston`, `Cubos`, cambio de default a `Baston`;
  - Cebolla vendible/visible con precio `6500.00`, cortes `Juliana`, `Cubos`, default `Juliana`;
  - inactivacion global de `Juliana` sin borrar la relacion existente.

### Validaciones negativas ejecutadas

- Nombre de corte vacio: `400`.
- Nombre duplicado dentro de organizacion: `409`.
- Corte duplicado en producto: `409`.
- Asignar corte inactivo: `400`.
- Precio de venta negativo: `400`.
- `viewer` intentando escribir: `403`.
- Usar corte de otra organizacion: `400`.
- Producto inactivo aceptando nueva configuracion: `400`.
- Producto no vendible visible en catalogo: `400`.

### Compatibilidad validada

- Productos: `GET /api/products` respondio `200`.
- Categorias: `GET /api/product-categories` respondio `200`.
- Depositos/inventario: `GET /api/warehouses` y `GET /api/inventory` respondieron `200`.
- Proveedores/compras: `GET /api/suppliers` y `GET /api/purchases` respondieron `200`.
- No se modifico la logica de costo promedio ni los movimientos de inventario por compras.

### Estado y pendientes

- Codigo, migracion, frontend, documentacion y pruebas API reales: completados.
- `docker compose ps` no pudo consultarse por permiso del pipe `dockerDesktopLinuxEngine`, aunque PostgreSQL local si estuvo disponible para migrar y probar.
- Ecommerce publico, carrito, pedidos, precios avanzados y recargos reales por corte quedan fuera de alcance.

## Mision 4.1 - Proveedores y compras operativas

### Alcance implementado

- Proveedores: listado con busqueda, alta, edicion, activacion e inactivacion sin borrado fisico.
- Compras: listado, detalle y registro con proveedor, deposito, fecha, factura/referencia, metodo de pago, notas e items multiples.
- Inventario: cada compra incrementa stock, registra movimiento en `inventory_adjustments` con `source_type = 'purchase'` y `purchase_order_id`, y recalcula costo promedio ponderado.
- Permisos: `owner`, `admin` y `operator` con lectura/escritura; `viewer` en solo lectura.

### Decisiones tomadas

- Se reutiliza `purchase_orders` como compra operativa del MVP.
- Se extiende `inventory_adjustments` para trazabilidad de compras, evitando un modelo paralelo de movimientos en esta etapa.
- `GET /api/products` acepta `productType` para que compras consuma materias primas activas sin cargar todo el catalogo.

### Validaciones ejecutadas

- `cd backend && npm.cmd run build`: exitoso.
- `cd frontend && npm.cmd run build`: exitoso.
- `cd backend && npm.cmd run db:migrate`: bloqueado por entorno. En sandbox fallo por `spawn EPERM`; fuera de sandbox ejecuto `tsx`, pero PostgreSQL rechazo conexion en `localhost:5432`.
- `docker compose ps`: bloqueado porque Docker Desktop no esta disponible (`dockerDesktopLinuxEngine` inexistente).

### Estado y pendientes

- Codigo y documentacion: implementados.
- Validacion con PostgreSQL real y flujo manual end-to-end: pendiente hasta levantar Docker Desktop/PostgreSQL local.
- Pendiente ejecutar el flujo manual completo: crear proveedor, registrar compra de 2 items, verificar compra, stock, movimiento, costo promedio, proveedor inactivo, producto no materia prima y permisos `viewer`.

## Estado de misiones

- [x] Épica 0 · Misión 0.1 — Entorno PostgreSQL local reproducible
- [x] Épica 0 · Misión 0.2 — Health, readiness y manejo seguro de conexión PostgreSQL
- [x] Épica 1 · Misión 1.1 — Sesiones seguras y perfil actual
- [x] Épica 1 · Misión 1.2 — Autorización por roles aplicada en API
- [x] Épica 1 · Misión 1.3 — Organización activa y gestión básica de miembros
- [x] Épica 2 · Misión 2.1 — CRUD operativo de productos
- [x] Épica 2 · Misión 2.2 — Categorías y unidades de medida
- [x] Épica 3 · Misión 3.1 — Tipos de producto, depósitos e inventario base

## Misión 0.1 · Registro de ejecución

### Decisiones tomadas

- Se agregó `docker-compose.yml` en la raíz con un único servicio `postgres` (`postgres:16`) para entorno local.
- Se usaron credenciales de desarrollo no sensibles:
  - usuario: `gastronexo`
  - contraseña: `gastronexo-dev`
  - base: `gastronexo_dev`
- Se expone `5432:5432`, se agregó volumen nombrado `gastronexo_postgres_data` y `healthcheck` con `pg_isready`.
- Se creó/ajustó `backend/.env.example` con configuración local (`NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN`).
- Se confirmó y reforzó el ignore de `backend/.env` en `.gitignore` para no versionar credenciales reales.

### Comandos de validación ejecutados

- `docker compose config`
- `docker compose up -d`
- `cd backend && npm run db:migrate`
- `cd backend && npm run build`
- `git check-ignore -v backend/.env`

### Resultado

- `docker compose config`: válido.
- PostgreSQL local: **no se pudo iniciar en esta validación** porque Docker Desktop no estaba disponible (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`).
- Validación de `npm run db:migrate` y `npm run build` en `backend/`: **bloqueada en este checkout**, porque no existe `backend/package.json`.
- `backend/.env` está ignorado por Git (`.gitignore:7:backend/.env backend/.env`).
- Estado final: Misión 0.1 completada a nivel de infraestructura/documentación local en este repositorio; queda pendiente ejecutar migraciones y build cuando esté presente el backend en el workspace.

## Misión 0.2 · Registro de ejecución

### Decisiones tomadas

- Se agregó `GET /ready` en la API para validar disponibilidad de PostgreSQL con una consulta mínima parametrizada (`SELECT $1::int`).
- Se mantuvo `GET /health` como liveness puro sin acceso a base de datos.
- Se reforzó `backend/src/server.ts` para:
  - fallar el arranque de forma clara si PostgreSQL no está disponible;
  - cerrar Fastify y el pool de PostgreSQL en `SIGINT` y `SIGTERM`;
  - evitar cierres repetidos y listeners duplicados.
- En respuestas de readiness y logs de arranque se evita exponer credenciales o detalles internos sensibles.

### Diferencia entre `/health` y `/ready`

- `/health`: indica que el proceso HTTP está vivo (liveness), siempre responde `200` mientras la API esté arriba.
- `/ready`: indica que la API está lista para atender requests que dependen de PostgreSQL (readiness).
  - Responde `200` con `{ "status": "ready" }` cuando la base está disponible.
  - Responde `503` con `{ "status": "not_ready" }` cuando la base no está disponible.

### Comandos de validación ejecutados

- `cd backend && npm.cmd run build`
- `docker compose up -d postgres`
- `cd backend && PORT=3001 npm.cmd run dev`
- `curl -s -o - -w "\n%{http_code}\n" http://localhost:3001/health`
- `curl -s -o - -w "\n%{http_code}\n" http://localhost:3001/ready`
- `docker compose stop postgres`
- `curl -s -o - -w "\n%{http_code}\n" http://localhost:3001/health`
- `curl -s -o - -w "\n%{http_code}\n" http://localhost:3001/ready`
- `docker compose up -d postgres`
- `curl -s -o - -w "\n%{http_code}\n" http://localhost:3001/ready`
- `docker compose stop postgres`
- `cd backend && PORT=3002 npm.cmd run start`
- `docker compose up -d postgres`

### Resultado

- Build de backend exitoso.
- Con PostgreSQL activo:
  - `/health` respondió `200`.
  - `/ready` respondió `200`.
- Con solo el contenedor PostgreSQL detenido:
  - `/health` siguió respondiendo `200`.
  - `/ready` respondió `503`.
- Con PostgreSQL detenido durante el arranque de prueba (`PORT=3002 npm.cmd run start`):
  - la API finalizó con código `1`;
  - el log indicó indisponibilidad de PostgreSQL sin exponer `DATABASE_URL`, usuario ni contraseña.
- PostgreSQL quedó nuevamente levantado al finalizar la validación.

## Misión 1.1 · Registro de ejecución

### Decisiones tomadas

- Se agregó `GET /api/auth/me` protegido con JWT para recuperar sesión actual desde API.
- La sesión se valida contra PostgreSQL por pertenencia activa: se consulta `users` + `organizations` + `memberships` usando `sub` y `organizationId` del token.
- Si la sesión no corresponde a una membresía activa (usuario/organización/membresía inexistente o inconsistente), la API responde `401` con mensaje genérico sin filtrar información.
- Se definió expiración explícita de JWT vía `JWT_EXPIRES_IN` (ejemplo de desarrollo: `8h`), validada en `backend/src/config.ts`.
- `register` y `login` mantienen su contrato previo; solo cambia que los tokens emitidos ahora incluyen expiración configurada.
- En frontend se reemplazó auth simulada por flujo real:
  - `POST /api/auth/login` para autenticar y guardar token;
  - `GET /api/auth/me` al iniciar para rehidratar sesión;
  - limpieza automática de sesión local ante `401`.
- El token se almacena en `localStorage` con clave namespaced: `gastronexo:auth:token`.

### Contrato de sesión

- `POST /api/auth/login` devuelve:
  - `token`
  - `user` (`id`, `email`, `fullName`)
  - `organization` (`id`, `name`, `slug`, `role`)
  - `organizations` (lista de membresías disponibles)
- `GET /api/auth/me` requiere `Authorization: Bearer <token>` y devuelve:
  - `user` (`id`, `email`, `fullName`)
  - `organization` (`id`, `name`, `slug`, `role`)

### Validaciones previstas para cierre de misión

- Registrar usuario + organización nueva.
- Iniciar sesión desde frontend con credenciales válidas.
- Recargar navegador y verificar persistencia de sesión por `localStorage` + `/api/auth/me`.
- Cerrar sesión y verificar limpieza de token/estado.
- Invocar `/api/auth/me` con token inválido y validar respuesta `401`.

## Misión 1.2 · Registro de ejecución

### Decisiones tomadas

- Se creó un módulo reutilizable de autorización en `backend/src/security/authorization.ts` con:
  - validación de JWT por request;
  - resolución de membresía actual desde PostgreSQL (`memberships` + `users` + `organizations`) con `sub` + `organizationId`;
  - guard `requireOrganizationRole(...roles)` para usar por ruta;
  - capacidades derivadas en servidor por rol (`canReadProducts`, `canWriteProducts`, `canWriteAdmin`).
- El backend ya no confía exclusivamente en `request.user.role` del token para autorizar: usa el rol vigente en DB en cada request protegido.
- Manejo de errores genérico y consistente:
  - `401` para token inválido/expirado;
  - `403` para membresía inexistente o rol sin permiso.
- Se evitó duplicar lógica entre auth y módulos de dominio usando `getOrganizationAccess` como fuente única de contexto autorizado.

### Matriz mínima aplicada

- `owner`: lectura y escritura administrativa (`canReadProducts: true`, `canWriteProducts: true`, `canWriteAdmin: true`).
- `admin`: lectura y escritura administrativa (`canReadProducts: true`, `canWriteProducts: true`, `canWriteAdmin: true`).
- `operator`: lectura y escritura operativa de productos (`canReadProducts: true`, `canWriteProducts: true`, `canWriteAdmin: false`).
- `viewer`: solo lectura (`canReadProducts: true`, `canWriteProducts: false`, `canWriteAdmin: false`).
- Sin membresía activa: sin acceso (`403`).

### Endpoints y alcance

- `GET /api/products`: permitido para `owner`, `admin`, `operator`, `viewer`.
- `POST /api/products`: permitido para `owner`, `admin`, `operator`; `viewer` recibe `403`.
- `GET /api/auth/me`: mantiene sesión actual y ahora incluye `organization.capabilities` derivadas del rol vigente en DB.
- `GET /api/auth/permissions`: endpoint protegido para verificar rol/capacidades efectivas del usuario en la organización activa.

### Frontend

- Se actualizó el contrato de sesión (`frontend/src/shared/lib/auth-api.ts`) para incluir capacidades en `organization`.
- En shell de la app, la acción primaria de Productos se deshabilita para `viewer`.
- La autorización efectiva permanece en backend aunque el botón no se muestre/permita en UI.

### Limitaciones (intencionalmente fuera de alcance)

- No se incorporaron invitaciones de usuarios, cambio de organización activa, refresh tokens ni recuperación de contraseña.
- No se modificaron migraciones ni esquema de base de datos.

## Misión 1.3 · Registro de ejecución

### Decisiones tomadas

- Se agregó soporte explícito de múltiples organizaciones por usuario autenticado sin romper el flujo JWT actual.
- El backend valida membresía vigente en PostgreSQL para listar organizaciones y para cambiar organización activa antes de emitir un nuevo token.
- La emisión del token en `switch-organization` conserva expiración configurable (`JWT_EXPIRES_IN`) y actualiza `organizationId` + `role` según estado real en DB.
- Se incorporó módulo `organization-members` protegido con `owner/admin`, reutilizando `requireOrganizationRole(...)` y capacidades existentes; no se duplicó matriz de roles.
- Las operaciones de alta, cambio de rol y revocación de membresías se ejecutan con transacciones.
- Se agregó metadata de acciones por miembro en `GET /api/organization/members` para mejorar UX (roles asignables y revocación permitida), manteniendo backend como autoridad final de permisos.

### Endpoints agregados

- `GET /api/auth/organizations` (JWT): lista organizaciones donde el usuario tiene membresía activa.
  - Respuesta por organización: `id`, `name`, `slug`, `role`, `capabilities`.
- `POST /api/auth/switch-organization` (JWT): cambia organización activa con body `{ organizationId }`.
  - Verifica pertenencia en DB.
  - Si pertenece: devuelve `token` nuevo y `organization` activa con capacidades.
  - Si no pertenece: `403` genérico.
- `GET /api/organization/members` (`owner|admin`): lista miembros de organización activa con `fullName`, `email`, `role` y acciones permitidas.
- `POST /api/organization/members` (`owner|admin`): agrega usuario existente por `email` con rol `operator|viewer`.
- `PATCH /api/organization/members/:userId` (`owner|admin`): cambia rol entre `admin|operator|viewer`.
- `DELETE /api/organization/members/:userId` (`owner|admin`): revoca membresía.

### Reglas aplicadas

- Solo `owner` puede promover o degradar `admin`.
- No se permite degradar ni revocar al último `owner`.
- Un `owner` no puede revocar su propia membresía por estos endpoints.
- `owner` no es asignable por API en esta misión.
- Para actualización/revocación de miembro inexistente en la organización activa: `404` genérico.
- Se evita filtrar información entre organizaciones (validación estricta por `organization_id` activa).

### Frontend

- Se agregó selector de organización activa en `SystemShell`:
  - muestra organización actual,
  - consume organizaciones disponibles,
  - ejecuta `POST /api/auth/switch-organization`, reemplaza token y refresca sesión.
- El cambio de organización muestra estados de carga/error y no cierra sesión ni navega fuera del contexto en caso de fallo.
- Se agregó vista de miembros para `owner/admin`:
  - listado de miembros (`nombre`, `email`, `rol`),
  - alta por email como `operator/viewer`,
  - cambio de rol y revocación según acciones permitidas informadas por API,
  - estados de carga, vacío, error y éxito.

### Validación de misión

- Build backend: `cd backend && npm.cmd run build` ✅
- Build frontend: `cd frontend && npm.cmd run build` ✅
- Prueba manual/e2e local ejecutada:
  - usuario A con organización A;
  - usuario B con organización B;
  - B agregado a A como `viewer`;
  - login como B, cambio de organización B → A (`switch-organization`) exitoso;
  - con token de A, B solo ve datos de A y no puede escribir productos (bloqueo `403` por rol `viewer`);
  - intento de `admin` para gestionar otro `admin` bloqueado (`403`);
  - intento de degradar/revocar último `owner` bloqueado (`409`).

### Corrección puntual de robustez en error handler (Fastify parse 400)

- Contexto: una petición `DELETE` con `Content-Type: application/json` y body vacío puede generar error de parseo en Fastify (`400`).
- Ajuste aplicado: el handler global ahora preserva errores `400` de cliente y responde mensaje genérico seguro `{ "message": "Solicitud inválida." }` en lugar de escalar a `500`.
- Comportamientos preservados:
  - Zod: `400` con `Datos de entrada inválidos.` + `issues`.
  - JWT inválido/expirado: `401` con mensaje genérico de sesión.
  - Errores inesperados: `500` con `Ocurrió un error inesperado.`
- Validación manual de regresión:
  - request: `DELETE /api/organization/members/:userId` con header `Content-Type: application/json` y body vacío;
  - resultado esperado/obtenido tras el ajuste: `400` con `{ "message": "Solicitud inválida." }`.

## Misión 2.1 · Registro de ejecución

### Decisiones tomadas

- Se extendió `products.routes` manteniendo prefijo y autenticación JWT existentes (`/api/products`).
- Todas las lecturas y escrituras se filtran por `organization_id` de la organización activa en sesión.
- Se agregó validación con Zod para query params, UUID de `:id`, payloads de create/update y cambio de estado.
- Se implementó paginación defensiva con `page >= 1` y `pageSize` acotado a `1..100`.
- Se normaliza `sku` vacío a `null` para evitar colisiones innecesarias por string vacío en índice único.
- Se mantiene estrategia de error seguro:
  - `404` genérico para producto inexistente o fuera de la organización activa;
  - `409` para SKU duplicado dentro de la misma organización;
  - `403` para rol sin permiso de escritura.

### Endpoints de productos (Misión 2.1)

- `GET /api/products` (`owner|admin|operator|viewer`)
  - Query opcional:
    - `q`: búsqueda por `name` o `sku` (`ILIKE`).
    - `status`: `active` | `inactive` | `all` (default `active`).
    - `page`: entero >= 1.
    - `pageSize`: entero 1..100.
  - Respuesta: `{ products, pagination }` con `total`, `page`, `pageSize`, `totalPages`.
- `GET /api/products/:id` (`owner|admin|operator|viewer`)
  - Devuelve producto de organización activa o `404` genérico.
- `POST /api/products` (`owner|admin|operator`)
  - Alta de producto, con `409` en SKU duplicado de la misma organización.
- `PATCH /api/products/:id` (`owner|admin|operator`)
  - Actualiza `name`, `sku`, `unit`, `cost` (parcial); requiere al menos un campo.
- `PATCH /api/products/:id/status` (`owner|admin|operator`)
  - Actualiza `isActive` (`boolean`) para activar/inactivar sin borrado físico.

### Frontend

- `ProductsView` deja de ser placeholder y pasa a módulo operativo con:
  - tabla compacta (`nombre`, `SKU`, `unidad`, `costo`, `estado`, `acciones`);
  - búsqueda con debounce;
  - filtro de estado `Todos/Activos/Inactivos`;
  - paginación;
  - estados de carga, vacío, error y éxito.
- Se agregó formulario reutilizable para alta/edición con validación cliente:
  - `name` obligatorio;
  - `sku` opcional;
  - `unit` obligatoria;
  - `cost >= 0`.
- Costo mostrado en formato guaraní para interfaz: `Gs.` + separador local + sin decimales.
- La acción primaria del topbar en sección Productos abre alta para roles con `canWriteProducts`.
- Para `viewer`, la acción primaria se mantiene visible/deshabilitada con texto de permiso requerido.
- En filas de la tabla:
  - `editar` y `activar/inactivar` solo para roles con escritura;
  - `viewer` queda en solo lectura.

### Validación de misión

- Build backend: `cd backend && npm.cmd run build` ✅
- Build frontend: `cd frontend && npm.cmd run build` ✅
- Validaciones manuales objetivo de la misión:
  - owner crea, edita e inactiva producto;
  - búsqueda, filtro y paginación operativos;
  - viewer lista y no puede escribir (UI bloqueada + API `403`);
  - producto de otra organización retorna `404`;
  - SKU repetido en misma organización retorna `409`.

### Cierre de validación UI (real)

- Entorno usado para validación visual:
  - PostgreSQL por `docker compose` activo (`postgres:16` en `5432`).
  - Backend esperado en `http://localhost:3000` con `PORT=3000` y `FRONTEND_ORIGIN=http://localhost:5173`.
  - Frontend en `http://localhost:5173` con `VITE_API_URL=http://localhost:3000`.
- Ajuste de configuración detectado durante la prueba:
  - `3000` estaba ocupado por un proceso previo de API (error `EADDRINUSE`).
  - Se finalizó el proceso ocupando `3000` y se reinició backend para tomar el `.env` correcto.
  - No se requirieron cambios de código para resolverlo.
- Resultado de prueba UI con rol `owner`:
  - login exitoso;
  - acceso a módulo Productos;
  - alta desde acción primaria (`Nuevo producto`) exitosa;
  - edición por fila exitosa;
  - inactivación por fila con confirmación exitosa;
  - búsqueda por nombre/SKU funcional;
  - filtro por estado (`Activos`/`Inactivos`) funcional;
  - paginación funcional (lista activa en múltiples páginas).
- Resultado de prueba UI/API con rol `viewer`:
  - login exitoso;
  - navegación de `Miembros` oculta para viewer;
  - acción primaria de Productos visible pero deshabilitada;
  - filas de Productos en modo `Solo lectura` (sin botones de escritura);
  - intento de escritura por API (`POST /api/products`) responde `403` con mensaje de permiso.

### Fuera de alcance (se mantiene)

- No se implementó borrado físico de productos.
- No se agregaron categorías de productos en Misión 2.1 (resuelto en Misión 2.2).

## Misión 2.2 · Registro de ejecución

### Decisiones tomadas

- Se agregó migración incremental `002_product_categories.sql` sin alterar migraciones aplicadas previamente.
- Las categorías son por organización (`organization_id`) con nombre obligatorio y estado (`is_active`).
- Se añadió unicidad case-insensitive de nombre por organización con índice único sobre `lower(name)`.
- `products` incorpora `category_id` nullable para transición sin categoría.
- Las unidades de producto se restringen por API a catálogo fijo global:
  - `unit`, `kg`, `g`, `l`, `ml`, `box`, `portion`.
- No se implementa borrado físico de categorías.

### Endpoints y permisos

- `GET /api/product-categories?status=active|inactive|all` (`owner|admin|operator|viewer`, default `active`).
- `POST /api/product-categories` (`owner|admin|operator`).
- `PATCH /api/product-categories/:id` (`owner|admin|operator`) para renombrar.
- `PATCH /api/product-categories/:id/status` (`owner|admin|operator`) para activar/inactivar.
- `viewer` mantiene acceso de solo lectura y recibe `403` al intentar escritura.

### Reglas de negocio aplicadas

- Al asignar `categoryId` en `POST/PATCH /api/products`:
  - la categoría debe existir,
  - pertenecer a la organización activa,
  - estar activa.
- Si la categoría no cumple reglas (incluye categoría de otra organización), la API responde `404` genérico.
- Al inactivar categoría, si tiene productos activos asociados en la organización, la API responde `409` con mensaje de reasignar o inactivar primero esos productos.
- Lectura de productos (`listado` y `detalle`) ahora incluye `categoryId` y `categoryName`.

### Backend técnico

- Migración:
  - nueva tabla `product_categories`;
  - FK nullable `products.category_id -> product_categories.id`;
  - índices por `organization_id` y `category_id`.
- Operaciones que verifican relaciones y modifican estado usan transacciones (`BEGIN/COMMIT/ROLLBACK`) para consistencia.
- Se mantienen respuestas seguras y consistentes para `400`, `401`, `403`, `404`, `409`.

### Frontend (módulo Productos)

- Formulario de producto actualizado:
  - selector obligatorio de unidad desde catálogo local tipado;
  - selector opcional de categoría activa con opción explícita `Sin categoría`;
  - no se envía `categoryId` vacío como string.
- Tabla de productos:
  - nueva columna `Categoría`;
  - muestra `Sin categoría` cuando corresponda;
  - muestra etiqueta de unidad (ej. `Kilogramo`) en lugar de clave interna.
- Gestión compacta de categorías dentro de Productos:
  - listado por estado;
  - crear, renombrar, activar/inactivar según permisos;
  - viewer en solo lectura;
  - feedback de carga, error y éxito.
- Tras cambios en categorías se refrescan listado de productos y categorías activas del formulario.

## Misión 3.1 · Registro de ejecución

### Decisiones tomadas

- `products` se extendió con `product_type` (`raw_material` | `finished_product`) con default `raw_material` y no nulo para mantener compatibilidad con datos existentes.
- Se agregó modelo base de inventario por organización:
  - `warehouses` (depósitos por organización);
  - `inventory_balances` (saldo actual por `warehouse + product`);
  - `inventory_adjustments` (auditoría de ajustes manuales con motivo, usuario y delta).
- Se prohibió stock negativo en validación de API y en constraints de base de datos.

### Migración aplicada

- Nueva migración incremental: `backend/src/db/migrations/003_inventory_foundation.sql`.
- Cambios incluidos:
  - `products.product_type` con restricción de dominio y default `raw_material`.
  - `warehouses` con unicidad por organización case-insensitive (`organization_id + lower(name)`).
  - `inventory_balances` con `quantity >= 0`, unicidad por `warehouse_id + product_id`, FKs e índices por organización/depósito/producto.
  - `inventory_adjustments` con `previous_quantity`, `new_quantity`, `delta`, `reason`, `created_by_user_id`, `created_at` e índices de consulta.

### Endpoints incorporados

- Productos (`/api/products`): `GET/POST/PATCH` y `PATCH /:id/status` exponen y aceptan `productType`.
- Depósitos (`/api/warehouses`):
  - `GET ?status=active|inactive|all`
  - `POST`
  - `PATCH /:id`
  - `PATCH /:id/status`
  - Regla: no se puede inactivar depósito con inventario positivo (`409`).
- Inventario (`/api/inventory`):
  - `GET ?warehouseId=&productType=&q=&page=&pageSize=`.
  - Si el depósito filtrado está activo, incluye productos sin balance con `quantity = 0`.
- Ajustes (`/api/inventory/adjustments`):
  - `POST` con `warehouseId`, `productId`, `newQuantity`, `reason` (obligatorio).
  - `GET` con filtros `warehouseId`, `productId`, `from`, `to`, paginación.

### Permisos y seguridad

- Lectura (`warehouses`, `inventory`, `adjustments`): `owner|admin|operator|viewer`.
- Escritura (crear/editar/inactivar depósito y ajustar inventario): `owner|admin|operator`.
- `viewer` recibe `403` en escritura.
- Validación de pertenencia de producto/depósito a organización activa con respuesta segura (`404`) para recursos fuera de alcance.
- Ajustes de stock ejecutados en transacción con bloqueo (`FOR UPDATE`) para evitar inconsistencias por concurrencia.

### Frontend

- Productos:
  - formulario con selector obligatorio de tipo de producto;
  - tabla con etiqueta compacta de tipo (`Materia prima` / `Producto elaborado`).
- Stock:
  - reemplazo del placeholder por módulo funcional;
  - selector y gestión compacta de depósitos;
  - tabla de inventario con filtros, búsqueda, paginación y estados de carga/vacío/error;
  - formulario de ajuste con motivo obligatorio, previsualización de cantidad anterior y delta;
  - historial compacto de ajustes con filtros de producto/fecha.

### Limitaciones transitorias (fuera de alcance)

- No se implementaron movimientos inmutables generales ni integración automática con compras/producción/ventas/mermas.
- No se implementaron reservas, lotes, vencimientos, mínimos/máximos ni alertas.
