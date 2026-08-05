# Epic 00 - Foundation SaaS

## Misión 2 - Backend, migraciones y despliegue

### Objetivo

Dejar lista la base de despliegue del backend para DigitalOcean App Platform con PostgreSQL administrado, migraciones repetibles y un health check apto para producción.

### Configuración local

1. Entrar a `backend/`.
2. Copiar `backend/.env.example` a `.env`.
3. Completar `DATABASE_URL` con tu base local.
4. Ejecutar:

```bash
npm install
npm run migrate
npm run dev
```

### Variables de entorno

- `NODE_ENV`: `development` o `production`.
- `HOST`: host de escucha, recomendado `0.0.0.0` en App Platform.
- `PORT`: puerto HTTP, por defecto `8080`.
- `LOG_LEVEL`: nivel de logs de Fastify.
- `DATABASE_URL`: string de conexión a PostgreSQL.
- `DATABASE_SSL`: `true` para PostgreSQL administrado, `false` para local.
- `MIGRATIONS_DIR`: carpeta de migraciones SQL. En runtime compilado usa `dist/db/migrations`.

### Despliegue en DigitalOcean

La spec está en [`.do/app.yaml`](../../.do/app.yaml).

Puntos clave:

- build reproducible con `npm ci && npm run build`;
- arranque con `npm run start:prod`;
- health check HTTP en `/health`;
- migraciones ejecutadas al iniciar el servicio y protegidas con lock de PostgreSQL;
- `MIGRATIONS_DIR` apunta al directorio compilado para que las migraciones SQL estén disponibles en producción.

Antes de desplegar:

1. Crear la App en App Platform desde este repo.
2. Configurar la conexión al Managed PostgreSQL.
3. Definir `DATABASE_URL` como variable secreta o mediante el binding de la base administrada.
4. Confirmar que `DATABASE_SSL=true` si la conexión administrada lo requiere.

### Verificación

Después del deploy:

- `GET /health` debe responder `200`.
- `GET /ready` debe responder `200` si la base está accesible.
- Revisar logs de startup para confirmar que las migraciones terminaron sin errores.

### Rollback

- Para rollback de aplicación, volver a una release anterior desde App Platform.
- Si hubo cambios de esquema incompatibles, restaurar la base desde backup/snapshot de Managed PostgreSQL.
- Las migraciones son idempotentes y registran checksum; si un archivo cambia luego de aplicarse, el arranque falla para evitar drift silencioso.
