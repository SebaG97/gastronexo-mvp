# Misión 8.12 - Sesión en cookie HttpOnly

## Objetivo

Hasta la 8.11 el JWT de la sesión vivía en `localStorage`, donde cualquier script de la página puede leerlo: uno inyectado por un XSS, una librería comprometida o una extensión del navegador. Robado, el token sirve durante 8 horas desde cualquier lugar. Era un pendiente de seguridad antes de producción.

## Cómo queda

| | Antes | Ahora |
| --- | --- | --- |
| Dónde vive la sesión del navegador | `localStorage` (legible por JS) | Cookie `gx_session` **HttpOnly** (JS no la ve) |
| Atributos | — | `SameSite=Lax`, `Path=/api`, `Max-Age` = `JWT_EXPIRES_IN` y `Secure` en producción |
| JWT en la respuesta de login, registro y cambio de organización | Siempre | Solo para scripts. Al navegador (`X-Gastronexo-Client: web`) no se le devuelve |
| Cerrar sesión | Borraba `localStorage` | `POST /api/auth/logout` borra la cookie |
| Scripts e integraciones (`npm run demo`, `vista-previa`, stress) | `Authorization: Bearer` | Igual, sin cambios |

**Protección CSRF.** Con sesión por cookie, el navegador la manda solo, así que otro sitio podría intentar escrituras en nombre del usuario. Hay tres capas:

1. **`SameSite=Lax`:** los pedidos que otro sitio dispara en segundo plano no llevan la cookie.
2. **Header obligatorio:** toda escritura (no GET) que llega con la cookie y sin `Authorization` exige `X-Gastronexo-Client: web`; si falta, responde 403. Un formulario de otro sitio no puede mandar headers propios.
3. **CORS:** un `fetch` de otro origen con ese header necesita un preflight, y CORS solo lo aprueba para `FRONTEND_ORIGIN`.

**Frontend.**
- `apiRequest` usa `credentials: 'include'` y manda el header.
- Los componentes siguen recibiendo `token`, que ahora es un marcador (`COOKIE_SESSION`): no hizo falta tocar las 21 pantallas.
- Al arrancar se borra el token viejo de `localStorage`, si existía, y la sesión se recupera con `/api/auth/me` usando la cookie.

**Archivos:**
- `backend/src/security/session-cookie.ts`, nuevo;
- `app.ts`: `@fastify/cookie` 11.1.5, la cookie como fuente del JWT y el hook CSRF;
- `auth.routes.ts`;
- `frontend/src/shared/lib/auth-api.ts` y `App.tsx`.

## Límites (honestos)

- **Un XSS todavía puede actuar como el usuario** mientras la página está abierta. Lo que ya no puede es llevarse el token para usarlo en otro lado. La defensa contra XSS sigue siendo React (escapa todo) y no insertar HTML crudo.
- **Cerrar sesión borra la cookie del navegador, pero el JWT no se revoca:** sigue valiendo hasta que vence (8 h). Para revocar de verdad haría falta una lista de sesiones en la base. Queda anotado.
- **Un 401 en la consola del navegador:** quien entra sin sesión ve un `401` de `/api/auth/me` en la consola, porque así se detecta que no hay sesión. Es esperado.

## Despliegue

En App Platform la consola y la API comparten dominio, así que la cookie funciona sin configurar nada. En desarrollo, `localhost:5173` y `localhost:3000` cuentan como el mismo sitio y la cookie también viaja. Si la consola se sirviera desde otro dominio que la API, habría que revisar `SameSite`.

## Verificación

**API** (20 de 20 OK):

| Caso | Resultado |
| --- | --- |
| Login web | `Set-Cookie` con HttpOnly, SameSite=Lax, Path=/api, Max-Age=28800 y sin Secure en desarrollo |
| Cuerpo de la respuesta web | Sin JWT |
| CORS | Con credenciales solo para la consola |
| Lecturas con la cookie | 200 |
| Escritura con cookie y sin header, con `text/plain` o con header incorrecto | 403 |
| Escritura con cookie + header | 201 |
| Preflight desde otro origen | Sin permiso |
| Cambiar de organización | Renueva la cookie |
| Logout | 204 y borra la cookie |
| Logout sin header | 403 |
| Sin sesión o con cookie basura | 401 |
| Scripts con Bearer | Siguen funcionando |
| Tienda pública | Sigue sin sesión |

**Pantalla** (Playwright, 10 de 10 OK):
- un token viejo en `localStorage` no abre sesión y se borra;
- login por la pantalla, y después no queda ningún JWT en `localStorage`;
- `document.cookie` no muestra la sesión;
- el navegador guardó la cookie HttpOnly;
- al recargar sigue la sesión y las escrituras desde la consola funcionan;
- cerrar sesión borra la cookie y al recargar aparece el login.

**Regresión con sesión por cookie:**
- recorrido de las 12 secciones a 3 anchos (8.4);
- compra en la tienda en celular y escritorio (8.5);
- fotos de productos (8.7) y marca (8.8);
- `stress:writes` y `check:consistency` OK, y 0 errores en el log.
