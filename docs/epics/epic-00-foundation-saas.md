# Epic 00 - Foundation SaaS

## Misión 2 revisada - Desarrollo local

### Estado

Implementación local completada para levantar backend, frontend y PostgreSQL sin usar recursos externos.

### Decisiones

- PostgreSQL corre en Docker Compose con volumen persistente.
- El JWT se guarda explícitamente en `sessionStorage` para desarrollo.
- El frontend consume la API mediante `VITE_API_URL`.
- `GET /health` es liveness.
- `GET /ready` verifica conectividad real a PostgreSQL.
- `/api/auth/register`, `/api/auth/login`, `/api/auth/me` y `/api/products` quedan disponibles para el flujo local.

### Arranque local

1. Copiar `backend/.env.example` a `backend/.env`.
2. Copiar `frontend/.env.example` a `frontend/.env`.
3. Levantar PostgreSQL:

```bash
docker compose up -d postgres
```

4. Instalar y correr backend:

```bash
cd backend
npm install
npm run dev
```

5. Instalar y correr frontend:

```bash
cd frontend
npm install
npm run dev
```

### Variables de entorno

Backend:

- `DATABASE_URL=postgresql://gastronexo:gastronexo-dev@localhost:5432/gastronexo_dev`
- `DATABASE_SSL=false`
- `JWT_SECRET=dev-only-change-me`
- `JWT_ISSUER=gastronexo-local`
- `JWT_EXPIRES_IN_SECONDS=86400`
- `CORS_ORIGIN=http://localhost:5173`

Frontend:

- `VITE_API_URL=http://localhost:3001`

### Criterios de aceptación

- `docker compose up -d postgres` deja una base local persistente.
- `GET /health` responde sin tocar la base.
- `GET /ready` falla si PostgreSQL no responde.
- Login y registro devuelven JWT y habilitan la app.
- Productos lista y crea registros contra `/api/products`.
- Los builds de backend y frontend terminan OK.

### Notas

- No se crearon secretos reales.
- No se toca `.do/app.yaml`.
