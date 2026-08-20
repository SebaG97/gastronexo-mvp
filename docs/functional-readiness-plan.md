# Functional Readiness Plan

## Estado de misiones

- [x] Épica 0 · Misión 0.1 — Entorno PostgreSQL local reproducible
- [x] Épica 0 · Misión 0.2 — Health, readiness y manejo seguro de conexión PostgreSQL

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
