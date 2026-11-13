# Despliegue en DigitalOcean App Platform (Misión 7.5)

La especificación de la app está en [`.do/app.yaml`](../.do/app.yaml). Arma una sola app con:

| Componente | Tipo | Qué hace |
| --- | --- | --- |
| `web` | Static site (`frontend/`) | Consola y tienda pública en `/`. `catchall_document: index.html` hace que `/tienda/<slug>` y cualquier ruta funcionen al abrirlas directo. |
| `api` | Service (`backend/`) | API en `/api` (con `preserve_path_prefix`), Node 22, puerto 8080, health check `/health`. También despacha los avisos de pedidos. |
| `migrate` | Job `PRE_DEPLOY` | Corre `npm run db:migrate:prod` antes de cada despliegue. Si una migración falla, el despliegue se corta y queda la versión anterior. |
| `db` | PostgreSQL 16 administrado | Base de datos. La app recibe `${db.DATABASE_URL}` y `${db.CA_CERT}`. |

La consola, la tienda y la API comparten dominio, así que no hace falta configurar CORS ni la URL de la API en el frontend.

## Antes de empezar

1. **Rama.** La spec despliega `main` con `deploy_on_push: true`. Hay dos opciones:
   - mergear `sebag97-mvp-inicial` a `main` (recomendado);
   - cambiar `branch:` en los tres componentes.
2. **Acceso a GitHub.** En DigitalOcean → Apps → *Create App* → GitHub, autorizar el repo `SebaG97/gastronexo-mvp` (o `doctl apps create` lo pide la primera vez).
3. **Región.** La spec usa `nyc`. La base tiene que estar en la misma región (`nyc1`/`nyc3`) para usar la red privada.

## Paso 1. Base de datos

1. **Databases → Create → PostgreSQL 16**, misma región, nombre del cluster **`gastronexo-db`**. Si usás otro nombre, cambiá `cluster_name` en la spec.
2. Dentro del cluster no hace falta crear nada a mano: la spec declara la base `gastronexo` y el usuario `gastronexo`, y App Platform los crea al vincularla.
3. **Conexiones:** cada instancia de la API usa hasta `DB_POOL_MAX + 1` conexiones (la extra es la de `/ready`). La spec pone `DB_POOL_MAX=8`. Revisá el límite de conexiones del plan del cluster, y si es chico, bajalo o usá un connection pool del cluster.

## Paso 2. Secretos

Generá el secreto de sesión (en la terminal):

```bash
openssl rand -base64 48
```

| Variable | Dónde | Obligatoria |
| --- | --- | --- |
| `JWT_SECRET` | App-level (la usan la API y el job) | **Sí.** Con `NODE_ENV=production` la API no arranca con un valor de ejemplo. |
| `TELEGRAM_BOT_TOKEN` | Componente `api` | No. Sin valor, Telegram figura como "no configurado". Cómo crear el bot: `docs/mision-7.4-avisos-telegram-email.md`. |
| `RESEND_API_KEY` y `EMAIL_FROM` | Componente `api` | No. Sin valor, el email figura como "no configurado". |

Marcalas como **Encrypt** (tipo SECRET). Las variables vacías se ignoran: no impiden el arranque.

## Paso 3. Crear la app

Con doctl (autenticado en la cuenta correcta: `doctl auth switch --context <tu-contexto>`):

```bash
doctl apps spec validate .do/app.yaml
doctl apps create --spec .do/app.yaml
```

O desde el panel: **Apps → Create App → "Import from App Spec"** y subir `.do/app.yaml`.

Después, en **Settings**, cargá los secretos del Paso 2 y guardá. Eso dispara un despliegue.

## Paso 4. Primer despliegue

Orden de App Platform: build de los componentes → job `migrate` (crea las tablas, de la 001 a la 010) → API y web.

- **Logs del job:** `doctl apps logs <app-id> migrate --type run`. Tiene que mostrar `Applied migration 001_…` hasta `010_…`. En los despliegues siguientes no muestra nada si no hay migraciones nuevas.
- **API:** `https://<tu-app>.ondigitalocean.app/api/...` y el health check interno `/health`.

## Paso 5. Crear la primera organización

La consola todavía no tiene pantalla de registro (hallazgo H7). La primera cuenta se crea por la API:

```bash
curl -X POST https://<tu-app>.ondigitalocean.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Nombre Apellido","email":"tu@email.com","password":"una-clave-de-10-o-mas","organizationName":"Tu Negocio","organizationSlug":"tu-negocio"}'
```

- `organizationSlug` es el que aparece en el link de la tienda: `/tienda/tu-negocio`. Solo admite minúsculas, números y guiones.
- El registro está limitado a 5 por hora por IP.

Después:

1. Entrá a la consola con ese email y cargá depósito, productos (vendibles, visibles en catálogo y con precio) y stock.
2. En **Tienda online**: publicá la tienda, cargá los datos de contacto, el mínimo, las zonas y los pagos.
3. En **Tienda online → Avisos de pedidos nuevos**: conectá Telegram y/o cargá los emails, y tocá **Enviar mensaje de prueba**.
4. Hacé un pedido de prueba desde el link de la tienda en el celular y confirmalo desde Pedidos.

## Paso 6. Dominio propio (opcional)

**Settings → Domains → Add Domain**, y apuntá el DNS como indica el panel. `FRONTEND_ORIGIN` y `PUBLIC_APP_URL` usan `${APP_URL}`, que pasa a ser el dominio principal: no hay que tocar nada más.

## Qué resolvió la Misión 7.5 en el código

- **SSL de la base.** La URL de DigitalOcean trae `?sslmode=require`, y `node-postgres` la trataba como `verify-full` sin la CA, así que la conexión fallaba. Ahora los parámetros `ssl*` se quitan de la URL y el SSL se configura en `db/pool.ts`:
  - con `DATABASE_CA_CERT` (`${db.CA_CERT}`), verifica certificado y host;
  - sin CA, cifra sin verificar;
  - con `sslmode=disable` explícito, sin SSL.
- **IP real del cliente.** App Platform pone la IP del cliente en `do-connecting-ip`. `X-Forwarded-For` trae la del ingress, por lo que todos los clientes compartían el mismo límite de intentos. Con `CLIENT_IP_HEADER=do-connecting-ip` los límites de login, registro, tienda y prueba de avisos usan la IP real.
- **Migraciones sin dependencias de desarrollo:** `npm run build` copia los `.sql` a `dist/`, y `db:migrate:prod` corre con `node`.
- **Node 22** fijado con `engines` en los dos `package.json`.
- **Frontend en el mismo origen:** en producción, sin `VITE_API_URL`, llama a `/api/...`.
- **Variables vacías** (secretos sin cargar, `EMAIL_FROM: ""`) se tratan como no definidas, en lugar de impedir el arranque.

## Verificación local (simulación)

Sin acceso a la cuenta, se simuló el despliegue en local:

- `doctl apps spec validate .do/app.yaml --schema-only`: sin errores. No valida que existan los slugs de tamaño ni el cluster; eso lo valida `doctl apps spec validate` contra la cuenta.
- **Job de migraciones:** `NODE_ENV=production npm run db:migrate:prod` sobre una base **vacía** aplicó de la 001 a la 010 con el JavaScript compilado. La segunda corrida no hizo nada.
- **API** en modo producción en el puerto 8080, con los secretos de avisos vacíos: arrancó, y `/health` y `/ready` respondieron OK.
- **Frontend** compilado sin `VITE_API_URL`: el bundle no contiene `localhost:3000`.
- **Ingress simulado** (`/api` a la API con `do-connecting-ip` y `X-Forwarded-For` fijo del ingress, el resto al sitio estático con fallback a `index.html`), con Playwright:
  - registro de la primera organización por `/api` (201) y HSTS presente;
  - un cliente A queda bloqueado al 11º login fallido, y un cliente B **con el mismo email** desde otra IP entra (200): el límite usa la IP real y no la del ingress;
  - `/tienda/<slug>` abierto directo devuelve 200 y carga el catálogo;
  - un pedido de la tienda devuelve 201;
  - el login por la UI funciona y el pedido aparece en Pedidos;
  - una ruta inexistente devuelve `index.html`;
  - sin errores en la consola del navegador.
- **Opciones de SSL** comprobadas sin conectar: URL de DigitalOcean + CA → verifica con CA; sin CA → cifra sin verificar; local → sin SSL; `sslmode=disable` → sin SSL.
- **Regresión en desarrollo:** `stress:writes` OK y `check:consistency` OK.
- Screenshots en `docs/visual-qa/7.5/`.

**No verificado:** un despliegue real en App Platform (requiere tu cuenta), la conexión TLS real con la CA de un cluster administrado y los nombres de `instance_size_slug` contra la cuenta. El primer `doctl apps spec validate` (sin `--schema-only`) y el primer despliegue lo confirman.

## Operación

- **Escala:** `instance_count: 1`. Los avisos ya soportan varias instancias, pero los límites de intentos guardan sus contadores en memoria. Para escalar, primero hay que moverlos a Redis/Valkey.
- **Backups:** los clusters administrados tienen backups diarios automáticos con restauración a un punto en el tiempo. Antes de una migración grande, conviene además un `pg_dump -Fc` manual.
- **Logs:** `doctl apps logs <app-id> api --type run --follow`. Los envíos de avisos fallidos quedan en el log (nivel warn) y en la tabla "Últimos avisos" de la consola.
- **Rollback:** desde el panel, *Deployments → Rollback*. Ojo: no deshace migraciones. Todas las migraciones hasta ahora son aditivas.
