# Misión 7.1 - Endurecimiento de seguridad de la API

## Objetivo

Cerrar los huecos de seguridad de la API antes de exponerla fuera del entorno local: intentos de autenticación sin límite, enumeración de usuarios, carreras en la gestión de miembros (O1 de 6.3), headers y configuración de producción. La tienda pública ya tenía su propio límite desde 7.2.

## Fase 1 - Auditoría (2026-11-13)

| # | Hallazgo | Riesgo | Decisión |
| --- | --- | --- | --- |
| S1 | `POST /api/auth/login` sin límite de intentos | Fuerza bruta contra una cuenta | Corregido: límite por IP + email |
| S2 | `POST /api/auth/register` sin límite | Alta masiva de organizaciones | Corregido: límite por IP |
| S3 | Login con email inexistente responde sin correr bcrypt, mucho más rápido que uno existente con clave incorrecta | Enumeración de emails registrados por tiempo de respuesta | Corregido: se compara contra un hash de relleno |
| S4 | Registro concurrente con el mismo email o slug: el perdedor recibe 500 (`23505`) | Error interno visible, ruido en logs | Corregido: 409 con el mensaje de la restricción |
| S5 | O1 de 6.3: dos owners que se degradan o eliminan en paralelo pueden dejar la organización sin owner. El rol del actor se leía fuera de la transacción | Organización sin owner, acción con un rol ya revocado | Corregido: bloqueo de la organización y relectura del actor |
| S6 | Sin headers de seguridad (`nosniff`, `frame-ancestors`, HSTS) | Sniffing de contenido, clickjacking | Corregido: hook `onSend` |
| S7 | `imageUrl` usa `z.string().url()`, que acepta `javascript:`, `data:` y `file:` | URL peligrosa guardada y servida por la tienda | Corregido: solo `http`/`https` |
| S8 | `bodyLimit` por defecto de 1 MB | Consumo de memoria con cuerpos grandes | Corregido: 256 KB y 413 con mensaje propio |
| S9 | Verificación del JWT sin fijar el algoritmo | Defensa en profundidad (la librería ya rechaza `none`) | Corregido: `algorithms: ['HS256']` |
| S10 | La API arranca en producción con el `JWT_SECRET` de `.env.example` | Tokens falsificables | Corregido: la configuración rechaza secretos de ejemplo o triviales con `NODE_ENV=production` |
| S11 | Detrás de un proxy los límites ven la IP del proxy | Un cliente bloquea a todos, o nadie queda bloqueado | Corregido: `TRUST_PROXY` configurable |

Revisado sin cambios:

- **Aislamiento entre organizaciones:** un escaneo de todas las consultas SQL de `src/modules` encontró solo 5 sin `organization_id` en el texto. Todas están bien: login y alta de miembro (búsqueda de usuario por email), historial de un pedido ya filtrado por organización, y dos consultas dinámicas que agregan el filtro de organización como primer parámetro.
- **Sesión:** cada request autenticado relee la membresía en la base, así que un miembro eliminado pierde acceso en el siguiente request aunque su token siga vigente.
- **Errores:** los 500 devuelven un mensaje genérico. El logger de Fastify no registra headers (`Authorization`).
- **Token en `localStorage` (frontend):** se mantiene. Moverlo a una cookie `HttpOnly` requiere protección CSRF y cambiar el contrato de sesión, y queda para una misión aparte. Mitiga: el frontend no inserta HTML de usuarios y la tienda no comparte el bundle de la consola.

## Cambios

- `auth.routes.ts`: `@fastify/rate-limit` con alcance local al plugin. El login cuenta por IP + email normalizado, evaluado en `preHandler` después de parsear el body, para frenar la fuerza bruta sin bloquear a toda una oficina que comparte IP. El registro cuenta por IP. Ambos responden `429 rate_limited` desde el manejador global. Hash de relleno para emails inexistentes. `23505` en el registro → 409.
- `organization-members.routes.ts`: `lockMembershipChanges()` toma `organizations ... FOR NO KEY UPDATE` al inicio de `PATCH` y `DELETE` de miembros. La cabecera va primero, como en el orden canónico de 6.3, y `NO KEY` no choca con los `FOR KEY SHARE` de las FK. Después relee el rol del actor: si ya no es owner/admin, 403.
- `app.ts`: headers de seguridad, `bodyLimit` de 256 KB con 413, `trustProxy`, JWT solo HS256.
- `config.ts`: `AUTH_LOGIN_MAX_ATTEMPTS` (10), `AUTH_LOGIN_WINDOW_MINUTES` (15), `AUTH_REGISTER_MAX_PER_HOUR` (5), `TRUST_PROXY`, y guarda del `JWT_SECRET` en producción.
- `products.routes.ts`: `imageUrl` solo `http`/`https`.

No hay migración. El contrato de la API no cambia, salvo las respuestas nuevas 429 y 413 y el 409 en lugar de 500.

## Verificación

Contra la API local compilada (`dist/`) y PostgreSQL 16 en Docker:

- **Límites (valores por defecto):** 5 registros → 201 y el sexto → 429. Diez logins fallidos → 401 y el undécimo → 429 `rate_limited`, incluso con la clave correcta y con el email en mayúsculas. Otra cuenta desde la misma IP sigue entrando (200).
- **Tiempo de login:** mediana de 328 ms con email existente y 283 ms con email inexistente (antes de la corrección, el inexistente no corría bcrypt).
- **Registro concurrente:** 4 registros simultáneos con el mismo email → 201 + 3 × 409. Lo mismo con el mismo slug.
- **`imageUrl`:** `javascript:`, `data:` y `file:` → 400. `https://` → 201.
- **Body de 300 KB** → 413 "La solicitud es demasiado grande."
- **JWT** con `alg: none` o con el payload alterado (otra organización, rol owner) → 401.
- **O1:** 10 rondas con dos owners que se degradan (`PATCH`) o se eliminan (`DELETE`) entre sí en paralelo. En todas, una operación gana y la otra recibe 409 (último owner) o 403 (el actor ya no es miembro), con exactamente 1 owner al final y sin 5xx. El segundo owner se creó por SQL solo en la organización de prueba, porque la API no permite promover a owner. No se corrió una línea base con el código anterior.
- **`JWT_SECRET`:** con `NODE_ENV=production` y el secreto de ejemplo, la configuración se rechaza. Con uno aleatorio, arranca.
- **Regresión:** `stress:writes` OK (371 escrituras, 0 deadlocks, 0 lock timeouts). `check:consistency` OK. El log de la API no registró errores (nivel 50).
- **Headers:** `/health` devuelve `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` y `Cross-Origin-Opener-Policy: same-origin`. HSTS solo en producción.

## Pendientes

- Los contadores de los límites viven en memoria. Con más de una instancia de la API hay que pasarlos a Redis (igual que la tienda).
- El token en `localStorage` debería pasar a una cookie `HttpOnly` + `SameSite` con protección CSRF.
- No hay bloqueo de cuenta ni aviso por email ante muchos intentos fallidos, ni recuperación de contraseña.
- `W1` (inactivar un depósito no bloquea un ajuste concurrente) sigue abierto. No es un tema de seguridad, queda para una misión de consistencia.
- La suite E2E de 6.2 sigue sin estar disponible en esta máquina.
