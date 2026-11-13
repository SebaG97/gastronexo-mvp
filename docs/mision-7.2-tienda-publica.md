# Misión 7.2 - Tienda pública con carrito (sin pasarela de pago)

## Objetivo

Un cliente final entra a la tienda pública de una organización, navega el catálogo, arma un carrito, completa sus datos y envía el pedido. El pedido aparece en **Pedidos** del área administrativa como `new`, con su número `PED-` y marcado como canal **Tienda**, y desde ahí sigue el flujo existente (confirmar → reservar stock → preparar → listo → entregar).

Referencia **funcional** (no visual): https://hortifrutipinda.webloja.app. Se toma el flujo (catálogo por categorías → carrito → datos → entrega → forma de pago → confirmación). El estilo es propio de Gastronexo y se ajusta en una misión de retoques posterior.

## Reglas de la misión

- **Sin pasarela de pago.** La forma de pago es solo informativa (efectivo con "paga con", transferencia, tarjeta contra entrega). No hay cobro online, QR ni estados de pago.
- **Un solo motor de pedidos** (`client-requirements.md`): la tienda no calcula precios ni crea pedidos por su cuenta. El backend resuelve precio, corte, subtotal y total con la misma lógica que `POST /api/orders` (extraer a un servicio compartido, no duplicar).
- El carrito vive en el navegador (`localStorage`); el precio que manda es siempre el del backend al confirmar.
- Sin cuentas de cliente: compra como invitado. Sin login, historial ni "repetir pedido" en esta misión.
- Respetar 6.3: toda escritura dentro de `withTransaction`, orden de bloqueo canónico, errores de infraestructura → 503.

## Fase 0 - Preparación

- Rama limpia y `pg_dump -Fc` fuera del repo (`~/gastronexo-backups/pre-mision-7.2-<fecha>.dump`).
- Línea base: `stress:writes`, `check:consistency` y suite E2E de 6.2 en verde antes de tocar código.

## Fase 1 - Auditoría (antes de escribir código)

Documentar en esta misma página:

1. Qué parte de `orders.routes.ts` (`prepareItems`, validación de cliente, numeración `PED-`, historial) se extrae a `orders.service.ts` para reutilizarla desde la ruta pública sin cambiar el contrato de `/api/orders`.
2. Bloqueos del esquema actual para pedidos sin usuario:
   - `orders.created_by` y `order_status_history.changed_by` son `NOT NULL` → hay que permitir `NULL` cuando el canal es tienda (con `CHECK`).
   - `customers` tiene índice único por `lower(name)` → dos clientes web con el mismo nombre chocan. Definir la regla (propuesta en Fase 2).
3. Qué datos de producto se pueden exponer públicamente (nunca costo, stock exacto ni IDs internos que no hagan falta).

## Fase 2 - Migración `009_storefront.sql`

- **Configuración de la tienda** (`storefront_settings`, una fila por organización): `is_enabled`, nombre visible, teléfono/WhatsApp de contacto, dirección de retiro, horario en texto, `min_order_amount`, `allows_pickup`, `allows_delivery`, mensaje de "hora de corte" (ej. "pedidos después de las 15 h salen al día siguiente"), métodos de pago habilitados.
- **Zonas de envío** (`delivery_zones`): nombre (barrio/zona), costo, `is_active`, `sort_order`.
- **Pedidos**:
  - `channel` (`admin` | `storefront`, default `admin`).
  - `fulfillment_type` (`pickup` | `delivery`, nullable para pedidos admin existentes).
  - `delivery_zone_id`, `delivery_fee` (default 0; `total = subtotal + delivery_fee`), `delivery_address`, `delivery_reference`.
  - `payment_method` y `cash_change_for` (informativos).
  - `contact_name`, `contact_phone`, `contact_email` (snapshot de lo que escribió el cliente).
  - `created_by` nullable con `CHECK (channel = 'storefront' OR created_by IS NOT NULL)`; lo mismo para `order_status_history.changed_by` en la fila inicial.
- **Productos**: `description` (texto opcional) e `image_url` (opcional) para el catálogo. Visibilidad ya existe: `is_catalog_visible` + `is_sellable` + `sale_price`.
- **Clientes**: agregar `phone_normalized` con índice único parcial por organización. El cliente web se busca por teléfono normalizado; si no existe se crea. Si el nombre choca con otro cliente, se crea como `"<nombre> (<últimos 4 del teléfono>)"`. No se modifican clientes existentes.

## Fase 3 - Backend

### Endpoints públicos (`/api/public/:slug/...`, sin JWT)

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/store` | Datos de la tienda: nombre, contacto, horario, retiro/envío, mínimo, métodos de pago, zonas activas con costo. 404 si la tienda está deshabilitada o el slug no existe. |
| GET | `/categories` | Categorías activas con al menos un producto visible, con conteo. |
| GET | `/products` | Productos activos, vendibles, visibles y con precio. Filtros `q`, `categoryId`, `sort` (nombre, precio asc/desc), paginación. Devuelve nombre, descripción, imagen, unidad, precio, categoría, cortes activos (con recargo y default) y disponibilidad simple (`available` / `last_units` / `out_of_stock`) derivada de `quantity - reserved_quantity`, sin exponer cantidades. |
| GET | `/products/:id` | Detalle del producto visible. |
| POST | `/cart/quote` | Recibe ítems + zona/tipo de entrega y devuelve precios, subtotales, envío, total y avisos por ítem (no disponible, sin stock, precio cambiado). No escribe. |
| POST | `/orders` | Crea el pedido (ver abajo). |
| GET | `/orders/:publicToken` | Estado y resumen del pedido para la pantalla de confirmación, con un token opaco (no el UUID ni el número). |

### Reglas de `POST /orders`

- Valida con Zod: contacto (nombre y teléfono obligatorios, email opcional), entrega (`pickup` o `delivery` con zona activa y dirección), pago (método habilitado; `cashChangeFor >= total` si es efectivo), notas (≤ 500), ítems (1-100, cantidades > 0; unidades `unit/box/portion` solo enteras).
- Recalcula todo con el servicio compartido: producto visible y vendible, corte válido, precio vigente. Si el total no coincide con el que vio el cliente, responde `409 price_changed` con la cotización nueva para que el front la muestre.
- Rechaza si no llega al mínimo (`400 below_minimum`) o si la tienda está deshabilitada (`404`).
- En una transacción: busca/crea cliente → numera `PED-` → inserta pedido con `channel = 'storefront'`, estado `new`, ítems y fila inicial de historial con `changed_by = NULL`. **No reserva stock**: la reserva ocurre al confirmar desde administración, como hoy.
- **Idempotencia**: header `Idempotency-Key` generado por el front; un reintento con la misma clave devuelve el mismo pedido (evita pedidos duplicados por doble click o red lenta).
- **Protección mínima** (adelanto de 7.1, solo para `/api/public`): límite por IP para `POST /orders` y `/cart/quote` con `@fastify/rate-limit`, y honeypot en el formulario.
- CORS: permitir el origen de la tienda (variable `STOREFRONT_ORIGIN`).

### Endpoints administrativos

- `GET/PUT /api/storefront/settings` y CRUD de `/api/delivery-zones` (`owner|admin` escriben; resto lee).
- `GET /api/orders` acepta filtro `channel` y devuelve `channel`, `fulfillmentType`, `deliveryFee`, contacto y pago; el detalle muestra los mismos campos.
- Productos: aceptar `description` e `imageUrl` en alta/edición.

## Fase 4 - Frontend

### Tienda pública (`/tienda/:slug`, sin el shell administrativo)

- **Inicio/catálogo**: cabecera con nombre, horario, contacto y contador del carrito; buscador; chips o barra de categorías; orden; grilla de productos con imagen (placeholder si no tiene), nombre, precio por unidad, badge "Últimas unidades" / "Sin stock" y botón **Agregar**. Con el producto ya en el carrito el botón pasa a stepper `– cantidad +` (decimales en kg, enteros en unidades).
- **Detalle de producto** (modal o página): descripción, selector de corte con recargo, cantidad y subtotal en vivo.
- **Carrito** (panel lateral en escritorio, pantalla completa en móvil): líneas editables, quitar con **Deshacer**, subtotal, aviso de mínimo con lo que falta, "Seguir comprando" y "Finalizar pedido". Persistido en `localStorage` por tienda; al abrirlo se recotiza con `/cart/quote` y se avisan cambios de precio o productos que ya no están disponibles.
- **Checkout en pasos** (Datos → Entrega → Pago → Revisión):
  - Datos: nombre, teléfono, email opcional.
  - Entrega: retiro (muestra dirección) o envío (zona con costo, dirección, referencia) y fecha deseada opcional.
  - Pago: métodos habilitados; efectivo pide "¿con cuánto pagás?".
  - Revisión: resumen completo con envío y total, notas (contador 500), botón **Enviar pedido** deshabilitado mientras envía.
- **Confirmación**: "¡Pedido recibido!", número `PED-`, resumen, estado actual y botón para escribir al negocio por WhatsApp con el número de pedido. Vacía el carrito.
- Estados vacíos, de carga y de error (tienda deshabilitada, sin productos, 503 con reintento).

### Área administrativa

- **Pedidos**: columna/badge de canal (Tienda / Interno), filtro por canal, y en el detalle bloque de entrega (tipo, zona, dirección, costo), contacto y forma de pago. Indicador de pedidos nuevos de la tienda (contador en el menú, refresco periódico).
- **Configuración → Tienda**: activar/desactivar, datos de contacto y horario, retiro/envío, mínimo, métodos de pago, zonas de envío y link copiable a la tienda.
- **Productos**: campos descripción e imagen (URL) y vista previa de cómo se ve en la tienda.

## Fuera de alcance

Pasarela de pago y estados de pago, cuentas de cliente e historial, cupones y descuentos, cálculo de envío por distancia o mapa, carga de imágenes a un storage (solo URL), notificaciones por email/WhatsApp automáticas, dominio propio por organización, SEO avanzado, ajustes de estilo finales (misión de retoques).

## Verificación

- `backend` y `frontend` compilan; `db:migrate` aplica `009` sobre la base actual y sobre una vacía.
- E2E nuevo (fuera del repo o en `backend/scripts`): tienda deshabilitada → 404; catálogo solo muestra visibles con precio; carrito con corte y kg decimal; precio cambiado → 409 y recotización; mínimo no alcanzado → 400; idempotencia (dos POST con la misma clave → un pedido); pedido de tienda aparece en `/api/orders` con `channel = storefront`, se confirma desde admin, reserva stock y se entrega; aislamiento entre organizaciones por slug; rate limit responde 429.
- Regresión: suite E2E de 6.2 79/79, `stress:writes` y `check:consistency` en verde, `/api/orders` sin cambios de contrato para pedidos internos.
- Screenshots 390 px y 1440 px en `docs/visual-qa/7.2/`: catálogo, detalle, carrito, cada paso del checkout, confirmación, pedido de tienda en admin y configuración de tienda.

## Datos de prueba

Cargar en la organización **Gastronexo** (`admin@gastronexo.com`): 3 categorías, 10-12 productos visibles con precio (algunos por kg con cortes, otros por unidad), un depósito con stock, 2-3 zonas de envío y la tienda habilitada en `/tienda/gastronexo`.

---

## Registro de ejecución (2026-11-09)

### Fase 0

- `pg_dump -Fc` en `~/gastronexo-backups/pre-mision-7.2-<fecha>.dump` antes de migrar.
- La suite E2E de 6.2 vive fuera del repo y no estaba disponible en esta máquina: **no se corrió**. La regresión se cubrió con `stress:writes`, `check:consistency` y flujos manuales (ver Verificación).

### Decisiones tomadas en la auditoría

- `orders.routes.ts` se partió: la lógica de precios, cortes, numeración e ítems pasó a `orders.service.ts` sin cambiar el contrato de `/api/orders`. `prepareOrderItems` acepta `{ storefront: true }`, que además exige `is_catalog_visible` y cantidades enteras para `unit`/`box`/`portion`.
- `orders.created_by` y `order_status_history.changed_by` pasan a aceptar `NULL`, con `CHECK (channel = 'storefront' OR created_by IS NOT NULL)`. Las lecturas usan `LEFT JOIN users` y la consola muestra "por la tienda online".
- Clientes de la tienda: se identifican por `phone_normalized` (solo dígitos, índice único parcial). Si el nombre ya existe se guarda como `Nombre (últimos 4 dígitos)`. Los clientes existentes no se modificaron.
- Al editar desde la consola un pedido de la tienda, `total = subtotal + delivery_fee` (el costo de envío se conserva).
- Disponibilidad pública: suma de `quantity - reserved_quantity` en depósitos activos, expuesta solo como `available` / `last_units` (≤ 5) / `out_of_stock`. Un producto sin stock se muestra pero no se puede agregar, y el backend rechaza el pedido con `409 cart_changed`.
- Catálogo: la tienda pide hasta 60 productos y filtra/busca en el navegador. Para catálogos más grandes hay que paginar con los parámetros que ya acepta `GET /products`.

### Implementado

- **Migración `009_storefront.sql`**: `storefront_settings`, `delivery_zones`, columnas de canal/entrega/pago/contacto/token/idempotencia en `orders`, `description` e `image_url` en `products`, `phone_normalized` en `customers`.
- **Backend**: `modules/storefront/` con `public.routes.ts` (`/api/public/:slug/...`), `storefront-admin.routes.ts` (`/api/storefront/settings` y `/zones`) y `storefront.service.ts`. `@fastify/rate-limit` solo en las rutas públicas: 8 pedidos y 60 cotizaciones por IP en sus ventanas, con respuesta `429 rate_limited`. Idempotencia por `Idempotency-Key` con resolución de la carrera por el índice único. Honeypot `website`. `STOREFRONT_ORIGIN` opcional para CORS.
- **Tienda** (`frontend/src/storefront/`, se carga sola en `/tienda/:slug` sin el JS ni el CSS de la consola): catálogo agrupado por categoría con buscador, orden y filtros; ficha con corte y cantidad; carrito lateral en escritorio y hoja inferior en móvil, con deshacer, barra de pedido mínimo y recotización; checkout en 4 pasos; confirmación con número, estado (se refresca cada 30 s) y botón de WhatsApp. El carrito y los datos de contacto se recuerdan en el navegador.
- **Consola**: canal y filtro en Pedidos, bloque de entrega/contacto/pago en el detalle, contador de pedidos nuevos de la tienda en el menú (cada 60 s), sección **Tienda online** (publicar, datos, mínimo, pagos, zonas, link copiable) y descripción e imagen en Productos.
- **Datos demo**: `backend/scripts/seed-storefront-demo.mjs` (`SEED_EMAIL`/`SEED_PASSWORD`, solo API local, repetible).

### Dirección visual

Sin copiar la referencia. Concepto: pizarra de mercado (verde `#23412F`) + etiqueta de precio de góndola (amarillo `#FFD43B`) con una sola familia tipográfica, Archivo, usando su eje de ancho: expandida para la marca, condensada para precios y números. Los productos se listan como una lista de precios (filas con separadores), no como tarjetas con sombra. Si un producto no tiene foto, se muestra un cuadrado con el color de su rubro y la inicial.

### Verificación

- `backend npm run build` y `frontend npm run build` sin errores. `db:migrate` aplicó `009`.
- Flujo completo en navegador (390 px y 1440 px): catálogo, ficha con corte, carrito, mínimo no alcanzado (botón deshabilitado), checkout con validaciones, envío y confirmación. Los pedidos llegaron a la consola como `new` con canal Tienda. Se confirmaron desde ahí reservando stock en Depósito central, y el contador del menú bajó.
- API: tienda inexistente o sin publicar → 404; producto de otra organización → `unavailable`; sin stock → `out_of_stock`; decimal en unidades → `invalid_quantity`; mínimo → `400 below_minimum`; total distinto → `409 price_changed`; dos POST simultáneos con la misma clave → un solo pedido (`201` + `200 replayed`); ráfaga de 10 POST → 429 desde el noveno.
- `stress:writes`: 371 escrituras, 0 errores, 0 deadlocks, probes 18/18. `check:consistency`: OK (incluye reservado = ítems de pedidos confirmados).
- Screenshots en `docs/visual-qa/7.2/`.

### Pendientes

- Correr la suite E2E de 6.2 cuando esté disponible.
- Imágenes: hoy es una URL. Falta subir archivos a un storage.
- Notificar al comercio por WhatsApp o email cuando entra un pedido (hoy: contador en la consola).
- El límite de peticiones guarda los contadores en memoria: con más de una instancia de la API hay que pasarlo a Redis.
- Retoques de estilo (próxima misión).
