# Functional Readiness Plan

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
