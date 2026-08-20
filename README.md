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
