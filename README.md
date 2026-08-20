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
