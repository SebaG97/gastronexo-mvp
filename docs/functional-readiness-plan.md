# Functional Readiness Plan

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
