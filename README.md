# Gastronexo MVP

Base frontend para una consola operativa de gestión gastronómica.

## Inicio rápido

```bash
cd frontend
npm install
npm run dev
```

## Build de producción

```bash
cd frontend
npm run build
```

La documentación de diseño y alcance está disponible en `docs/`.

## Desarrollo local

### Requisitos

- Node.js
- npm
- Docker Desktop

### Preparar entorno

1. Copiar variables de entorno del backend:

	```bash
	cp backend/.env.example backend/.env
	```

2. Copiar variables de entorno del frontend:

	```bash
	cp frontend/.env.example frontend/.env
	```

3. Levantar PostgreSQL local:

	```bash
	docker compose up -d
	```

4. Instalar dependencias del backend y ejecutar migraciones:

	```bash
	cd backend
	npm install
	npm run db:migrate
	npm run dev
	```

5. En otra terminal, instalar dependencias del frontend y levantar Vite:

	```bash
	cd frontend
	npm install
	npm run dev
	```

### Variables de entorno

Backend (`backend/.env`):

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN` (ejemplo: `8h`)
- `FRONTEND_ORIGIN`

Frontend (`frontend/.env`):

- `VITE_API_URL` (desarrollo local: `http://localhost:3000`)

### Verificar `health` y `ready` localmente

Con la API levantada en `http://localhost:3000`:

```bash
curl -i http://localhost:3000/health
curl -i http://localhost:3000/ready
```

Esperado con PostgreSQL activo:

- `/health` => `200` con `{"status":"ok"}`
- `/ready` => `200` con `{"status":"ready"}`

### Probar login y sesión local

1. Registrar cuenta + organización:

	```bash
	curl -i -X POST http://localhost:3000/api/auth/register \
	  -H "Content-Type: application/json" \
	  -d '{
	    "fullName": "Operaciones Demo",
	    "email": "ops-demo@negocio.com",
	    "password": "Segura12345!",
	    "organizationName": "Negocio Demo",
	    "organizationSlug": "negocio-demo"
	  }'
	```

2. Iniciar sesión desde la UI (`http://localhost:5173`) con ese email/contraseña.
3. Recargar navegador y verificar que la sesión se restaura.
4. Cerrar sesión desde el ícono de logout y verificar vuelta a pantalla de login.
5. Validar `/api/auth/me` con token inválido:

	```bash
	curl -i http://localhost:3000/api/auth/me -H "Authorization: Bearer token-invalido"
	```

Esperado: `401` con mensaje genérico de sesión inválida/expirada.

### Probar Misión 1.3 (multi-organización y miembros)

1. Registrar usuario A (owner de organización A):

	```bash
	curl -i -X POST http://localhost:3000/api/auth/register \
	  -H "Content-Type: application/json" \
	  -d '{
	    "fullName": "Owner A",
	    "email": "owner-a@example.com",
	    "password": "Segura12345!",
	    "organizationName": "Org A",
	    "organizationSlug": "org-a"
	  }'
	```

2. Registrar usuario B (owner de organización B):

	```bash
	curl -i -X POST http://localhost:3000/api/auth/register \
	  -H "Content-Type: application/json" \
	  -d '{
	    "fullName": "User B",
	    "email": "user-b@example.com",
	    "password": "Segura12345!",
	    "organizationName": "Org B",
	    "organizationSlug": "org-b"
	  }'
	```

3. Login como A y guardar token:

	```bash
	TOKEN_A=$(curl -s -X POST http://localhost:3000/api/auth/login \
	  -H "Content-Type: application/json" \
	  -d '{"email":"owner-a@example.com","password":"Segura12345!"}' | jq -r '.token')
	```

4. Agregar B a organización A como `viewer`:

	```bash
	curl -i -X POST http://localhost:3000/api/organization/members \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"email":"user-b@example.com","role":"viewer"}'
	```

5. Login como B (organización B activa) y obtener organizaciones:

	```bash
	TOKEN_B=$(curl -s -X POST http://localhost:3000/api/auth/login \
	  -H "Content-Type: application/json" \
	  -d '{"email":"user-b@example.com","password":"Segura12345!"}' | jq -r '.token')

	curl -i http://localhost:3000/api/auth/organizations \
	  -H "Authorization: Bearer $TOKEN_B"
	```

6. Cambiar organización activa de B a A:

	```bash
	ORG_A_ID=$(curl -s http://localhost:3000/api/auth/organizations \
	  -H "Authorization: Bearer $TOKEN_B" | jq -r '.organizations[] | select(.slug=="org-a") | .id')

	TOKEN_B_A=$(curl -s -X POST http://localhost:3000/api/auth/switch-organization \
	  -H "Authorization: Bearer $TOKEN_B" \
	  -H "Content-Type: application/json" \
	  -d "{\"organizationId\":\"$ORG_A_ID\"}" | jq -r '.token')
	```

7. Verificar aislamiento por organización:

	```bash
	curl -i http://localhost:3000/api/products \
	  -H "Authorization: Bearer $TOKEN_B_A"
	```

	- Con token de A activa, B solo debe ver productos de A.
	- Si B es `viewer`, `POST /api/products` debe responder `403`.

8. Verificar reglas de miembros:

	- Un `admin` no puede promover/degradar otro `admin` (`403`).
	- No se puede revocar ni degradar al último `owner` (`409`).
	- Un `owner` no puede revocar su propia membresía por estos endpoints.

### Probar Misión 2.1 (CRUD operativo de productos)

Con token de un rol con escritura (`owner|admin|operator`):

1. Crear producto:

	```bash
	curl -i -X POST http://localhost:3000/api/products \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{
	    "name": "Harina 000",
	    "sku": "HAR-000",
	    "unit": "kg",
	    "cost": 12000
	  }'
	```

2. Listar con filtros y paginación:

	```bash
	curl -i "http://localhost:3000/api/products?status=all&page=1&pageSize=10&q=har" \
	  -H "Authorization: Bearer $TOKEN_A"
	```

3. Obtener ID y consultar detalle:

	```bash
	PRODUCT_ID=$(curl -s "http://localhost:3000/api/products?status=all&page=1&pageSize=10&q=HAR-000" \
	  -H "Authorization: Bearer $TOKEN_A" | jq -r '.products[0].id')

	curl -i "http://localhost:3000/api/products/$PRODUCT_ID" \
	  -H "Authorization: Bearer $TOKEN_A"
	```

4. Editar producto:

	```bash
	curl -i -X PATCH "http://localhost:3000/api/products/$PRODUCT_ID" \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{
	    "name": "Harina 000 Premium",
	    "cost": 13000
	  }'
	```

5. Inactivar producto:

	```bash
	curl -i -X PATCH "http://localhost:3000/api/products/$PRODUCT_ID/status" \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"isActive": false}'
	```

6. Validar bloqueo de escritura para `viewer`:

	```bash
	curl -i -X POST http://localhost:3000/api/products \
	  -H "Authorization: Bearer $TOKEN_B_A" \
	  -H "Content-Type: application/json" \
	  -d '{"name":"No permitido","unit":"unit","cost":1000}'
	```

	Esperado: `403`.

7. Validar SKU duplicado en misma organización:

	```bash
	curl -i -X POST http://localhost:3000/api/products \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"name":"Harina Duplicada","sku":"HAR-000","unit":"kg","cost":12000}'
	```

	Esperado: `409`.

8. Validar aislamiento entre organizaciones (404 en detalle ajeno):

	```bash
	# TOKEN_B pertenece a organización B (no A)
	curl -i "http://localhost:3000/api/products/$PRODUCT_ID" \
	  -H "Authorization: Bearer $TOKEN_B"
	```

	Esperado: `404` genérico.

9. Verificación UI:

	- En sección Productos, acción primaria "Nuevo producto" abre formulario para `owner|admin|operator`.
	- Para `viewer`, acción primaria visible pero deshabilitada con motivo de permisos.
	- Tabla permite editar y activar/inactivar solo para roles con escritura.

### Probar Misión 2.2 (categorías y unidades)

Con token de un rol con escritura (`owner|admin|operator`):

1. Crear categoría:

	```bash
	curl -i -X POST http://localhost:3000/api/product-categories \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"name":"Secos"}'
	```

2. Listar categorías activas:

	```bash
	curl -i "http://localhost:3000/api/product-categories?status=active" \
	  -H "Authorization: Bearer $TOKEN_A"
	```

3. Crear producto con categoría y unidad válida:

	```bash
	CATEGORY_ID=$(curl -s "http://localhost:3000/api/product-categories?status=active" \
	  -H "Authorization: Bearer $TOKEN_A" | jq -r '.categories[0].id')

	curl -i -X POST http://localhost:3000/api/products \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d "{\"name\":\"Queso rallado\",\"unit\":\"kg\",\"cost\":25000,\"categoryId\":\"$CATEGORY_ID\"}"
	```

4. Verificar rechazo de unidad inválida (`400`):

	```bash
	curl -i -X POST http://localhost:3000/api/products \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"name":"Unidad inválida","unit":"lb","cost":1000}'
	```

5. Verificar rechazo de categoría de otra organización (`404` genérico):

	```bash
	OTHER_CATEGORY_ID=$(curl -s "http://localhost:3000/api/product-categories?status=active" \
	  -H "Authorization: Bearer $TOKEN_B" | jq -r '.categories[0].id')

	curl -i -X POST http://localhost:3000/api/products \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d "{\"name\":\"Cruce inválido\",\"unit\":\"unit\",\"cost\":1000,\"categoryId\":\"$OTHER_CATEGORY_ID\"}"
	```

6. Intentar inactivar categoría con productos activos (`409`):

	```bash
	curl -i -X PATCH "http://localhost:3000/api/product-categories/$CATEGORY_ID/status" \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"isActive":false}'
	```

7. Inactivar categoría sin productos activos (éxito):

	```bash
	# Reasignar o inactivar primero productos activos de la categoría
	curl -i -X PATCH "http://localhost:3000/api/product-categories/$CATEGORY_ID/status" \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"isActive":false}'
	```

8. Verificar permisos de `viewer`:

	```bash
	curl -i "http://localhost:3000/api/product-categories?status=all" \
	  -H "Authorization: Bearer $TOKEN_B_A"

	curl -i -X POST http://localhost:3000/api/product-categories \
	  -H "Authorization: Bearer $TOKEN_B_A" \
	  -H "Content-Type: application/json" \
	  -d '{"name":"No permitido"}'
	```

Unidades permitidas por API: `unit`, `kg`, `g`, `l`, `ml`, `box`, `portion`.

### Probar Misión 3.1 (tipos de producto, depósitos e inventario base)

1. Ejecutar migraciones y builds solicitados:

	```bash
	cd backend && npm.cmd run db:migrate
	cd backend && npm.cmd run build
	cd frontend && npm.cmd run build
	```

2. Verificar producto existente como `raw_material` (post-migración):

	```bash
	curl -i "http://localhost:3000/api/products?status=all&page=1&pageSize=20" \
	  -H "Authorization: Bearer $TOKEN_A"
	```

	Esperado: cada producto incluye `productType`, y los previos aparecen como `raw_material`.

3. Crear producto `raw_material` y `finished_product`:

	```bash
	curl -i -X POST http://localhost:3000/api/products \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"name":"Tomate fresco","unit":"kg","productType":"raw_material","cost":8000}'

	curl -i -X POST http://localhost:3000/api/products \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"name":"Salsa lista","unit":"portion","productType":"finished_product","cost":12000}'
	```

4. Crear depósitos en dos organizaciones y validar aislamiento:

	```bash
	curl -i -X POST http://localhost:3000/api/warehouses \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"name":"Depósito A"}'

	curl -i -X POST http://localhost:3000/api/warehouses \
	  -H "Authorization: Bearer $TOKEN_B" \
	  -H "Content-Type: application/json" \
	  -d '{"name":"Depósito B"}'
	```

5. Ajustar stock positivo, cero y negativo:

	```bash
	WAREHOUSE_A_ID=$(curl -s "http://localhost:3000/api/warehouses?status=active" \
	  -H "Authorization: Bearer $TOKEN_A" | jq -r '.warehouses[0].id')

	PRODUCT_A_ID=$(curl -s "http://localhost:3000/api/products?status=active&page=1&pageSize=20" \
	  -H "Authorization: Bearer $TOKEN_A" | jq -r '.products[0].id')

	curl -i -X POST http://localhost:3000/api/inventory/adjustments \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d "{\"warehouseId\":\"$WAREHOUSE_A_ID\",\"productId\":\"$PRODUCT_A_ID\",\"newQuantity\":10,\"reason\":\"conteo inicial\"}"

	curl -i -X POST http://localhost:3000/api/inventory/adjustments \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d "{\"warehouseId\":\"$WAREHOUSE_A_ID\",\"productId\":\"$PRODUCT_A_ID\",\"newQuantity\":0,\"reason\":\"ajuste a cero\"}"

	curl -i -X POST http://localhost:3000/api/inventory/adjustments \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d "{\"warehouseId\":\"$WAREHOUSE_A_ID\",\"productId\":\"$PRODUCT_A_ID\",\"newQuantity\":-1,\"reason\":\"inválido\"}"
	```

	Esperado: el tercer request devuelve `400`.

6. Verificar historial y delta:

	```bash
	curl -i "http://localhost:3000/api/inventory/adjustments?warehouseId=$WAREHOUSE_A_ID&page=1&pageSize=20" \
	  -H "Authorization: Bearer $TOKEN_A"
	```

7. Intentar ajustar con depósito/producto de otra organización (`404` genérico):

	```bash
	WAREHOUSE_B_ID=$(curl -s "http://localhost:3000/api/warehouses?status=active" \
	  -H "Authorization: Bearer $TOKEN_B" | jq -r '.warehouses[0].id')

	curl -i -X POST http://localhost:3000/api/inventory/adjustments \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d "{\"warehouseId\":\"$WAREHOUSE_B_ID\",\"productId\":\"$PRODUCT_A_ID\",\"newQuantity\":1,\"reason\":\"cruce inválido\"}"
	```

8. Intentar inactivar depósito con stock positivo (`409`):

	```bash
	curl -i -X PATCH "http://localhost:3000/api/warehouses/$WAREHOUSE_A_ID/status" \
	  -H "Authorization: Bearer $TOKEN_A" \
	  -H "Content-Type: application/json" \
	  -d '{"isActive":false}'
	```

9. Verificar `viewer` en solo lectura:

	```bash
	curl -i "http://localhost:3000/api/inventory?warehouseId=$WAREHOUSE_A_ID&page=1&pageSize=10" \
	  -H "Authorization: Bearer $TOKEN_B_A"

	curl -i -X POST http://localhost:3000/api/inventory/adjustments \
	  -H "Authorization: Bearer $TOKEN_B_A" \
	  -H "Content-Type: application/json" \
	  -d "{\"warehouseId\":\"$WAREHOUSE_A_ID\",\"productId\":\"$PRODUCT_A_ID\",\"newQuantity\":2,\"reason\":\"no permitido\"}"
	```

	Esperado: lectura OK y escritura `403`.

Para simular base no disponible sin apagar la API:

```bash
docker compose stop postgres
curl -i http://localhost:3000/health
curl -i http://localhost:3000/ready
docker compose up -d postgres
```

Esperado con PostgreSQL detenido:

- `/health` => `200`
- `/ready` => `503` con `{"status":"not_ready"}`

### Detener y reiniciar PostgreSQL

- Detener:

  ```bash
  docker compose down
  ```

- Reiniciar:

  ```bash
  docker compose restart postgres
  ```

### Reiniciar desde cero (eliminar datos locales)

> ⚠️ Este comando elimina **solo** el volumen local de PostgreSQL de Gastronexo y se perderán los datos locales.

```bash
docker compose down
docker volume rm gastronexo-mvp_gastronexo_postgres_data
docker compose up -d
```
