# Misión 7.4 - Avisos de pedidos por Telegram y email

## Objetivo

Que el comercio se entere de cada pedido de la tienda **aunque nadie tenga la consola abierta**. Completa la 7.3, que avisa solo dentro de la consola.

- **Telegram:** canal principal. Es gratis, se configura en minutos y sirve para un chat personal o un grupo del local.
- **Email (Resend):** opcional. Se usa una API HTTP en lugar de SMTP porque DigitalOcean suele bloquear los puertos SMTP salientes.

WhatsApp quedó descartado por ahora: la API oficial de Meta exige un número verificado y plantillas aprobadas.

## Cómo funciona

1. **Encolado (outbox).** Al crear un pedido de la tienda, en la **misma transacción** se inserta una fila por canal configurado en `order_notifications`. Si el pedido se guarda, su aviso también. Si el pedido se rechaza (mínimo, precio cambiado, etc.), no queda ningún aviso.
2. **Despacho.** Un proceso dentro de la API revisa la cola cada 5 s. Toma hasta 10 avisos con un **lease** (un `UPDATE … FOR UPDATE SKIP LOCKED` de una sola sentencia que corre `next_attempt_at` 2 minutos) y los envía **fuera de cualquier transacción**: no retiene conexiones del pool mientras habla con Telegram o con el email, como pide la regla de la 6.3. Con varias instancias de la API, cada aviso lo toma una sola.
3. **Reintentos.** Ante un error transitorio (red, 429, 5xx) se reintenta a los 30 s, 1, 2, 4 y 8 minutos, con un máximo de 6 intentos. Un error permanente (4xx: token inválido, bot expulsado del grupo, dominio no verificado) queda como `failed` al primer intento, con el error guardado.
4. **Vinculación de Telegram sin webhook.** En *Tienda online → Avisos de pedidos nuevos → Conectar Telegram* se genera un código de un solo uso, que vence en 15 minutos. El comercio abre `t.me/<bot>?start=<código>` o, en un grupo, escribe `/start <código>`. Mientras tanto, la consola consulta `getUpdates` cada 3 s hasta encontrar el código, vincula ese chat y el bot responde "Listo". El último update leído queda en la base (`telegram_bot_state`), así no se procesa dos veces. Funciona igual en local y en producción, sin URL pública.

Solo avisan los pedidos de la **tienda**: los que carga el equipo desde la consola no generan aviso.

## Mensaje

```
🛒 Nuevo pedido PED-000002 en Gastronexo Mercado

Cliente: Ana · 0981 555 123
Entrega: Retira en el local            (o: Envío a <zona> — <dirección> (<referencia>))
Pago: Efectivo (paga con Gs. 100.000)

• 8 kg Banana — Gs. 60.000

Productos: Gs. 60.000
Total: Gs. 60.000

Notas: Tocar timbre
Abrir Gastronexo                        (link a PUBLIC_APP_URL si está configurada)
```

En Telegram va en HTML, con los datos del cliente escapados. El email lleva versión de texto y HTML, y el asunto es "Nuevo pedido PED-… en <tienda>".

## Configuración del servidor

| Variable | Para qué |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token del bot. Sin esta variable, Telegram aparece como "no configurado" en la consola. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email por Resend. `EMAIL_FROM` debe usar un dominio verificado en Resend, por ejemplo `Gastronexo <pedidos@tudominio.com>`. |
| `PUBLIC_APP_URL` | URL de la consola para el link de los avisos (opcional). |
| `NOTIFICATIONS_WORKER_ENABLED` | `false` para no despachar desde ese proceso. Por defecto `true`. |
| `TELEGRAM_API_BASE`, `EMAIL_API_BASE` | Solo para pruebas con un servidor simulado. |

### Crear el bot de Telegram (una vez por instalación)

1. En Telegram, abrir **@BotFather** → `/newbot` → nombre (por ejemplo "Gastronexo Pedidos") y usuario (tiene que terminar en `bot`).
2. Copiar el token que devuelve y cargarlo como `TELEGRAM_BOT_TOKEN` (secreto) en el servidor.
3. Para usarlo en grupos, el bot no necesita ser administrador: los comandos `/start` le llegan igual.

El mismo bot sirve para todas las organizaciones: cada una vincula su chat con su propio código.

### Email con Resend

1. Crear la cuenta en resend.com y verificar el dominio (registros DNS que indica Resend).
2. Crear una API key con permiso de envío y cargarla como `RESEND_API_KEY`.
3. `EMAIL_FROM` con una dirección de ese dominio.

## Cambios

- **Migración `010_order_notifications.sql`:**
  - `notification_settings`: emails (hasta 5), chat de Telegram y código de vinculación con vencimiento.
  - `order_notifications`: la cola, con `UNIQUE (order_id, channel)` y `CHECK` de estados.
  - `telegram_bot_state`: el offset de `getUpdates`.
- **Backend (`modules/notifications/`):**
  - `channels.ts`: clientes HTTP de Telegram y Resend, con timeout de 10 s y clasificación de errores transitorios o permanentes. El token nunca se loguea.
  - `notifications.service.ts`: encolado, mensaje, lease y despacho, envío de prueba y vinculación.
  - `notification-worker.ts`: se inicia después de `listen` y se detiene antes de cerrar el pool en el apagado ordenado.
  - Rutas `/api/notifications`:
    - `GET /` (todos los roles).
    - `PUT /emails`, `POST /telegram/link`, `POST /telegram/check`, `DELETE /telegram` y `POST /test` (owner/admin; `/test` limitado a 5 por minuto).
  - `public.routes.ts`: `enqueueOrderNotifications` dentro de la transacción del pedido.
- **Frontend:** panel **Avisos de pedidos nuevos** en Tienda online, con:
  - el estado de cada canal;
  - la vinculación guiada, que se detecta sola sin recargar;
  - los emails;
  - el botón de prueba;
  - la tabla de **últimos avisos** con estado e intentos.

  Si el servidor rechaza un email, el mensaje dice cuál es; por ejemplo, la `ñ` antes de la `@` no es válida.

## Verificación

Contra la API local compilada, con un **servidor simulado** de Telegram (`getMe`, `getUpdates`, `sendMessage`) y de Resend (`/emails`) con inyección de fallas, en organizaciones nuevas cargadas con `seed-storefront-demo.mjs`:

- **Sin canales:** el pedido se crea (201) y no encola nada.
- **Vinculación:**
  - El código tiene 8 caracteres, con link `t.me/GastronexoTestBot?start=…`.
  - `/start@GastronexoTestBot <código en minúsculas>` desde un supergrupo vincula "Local Centro", y el grupo recibe la confirmación.
  - Un código inválido desde otro chat recibe "no es válido" y no vincula.
  - Un segundo `check` no reprocesa mensajes.
  - Un código ya usado no sirve para otro chat.
- **Emails:** uno inválido o más de 5 → 400. Se guardan normalizados y sin duplicados.
- **Mensaje de prueba:** OK por los dos canales.
- **Pedido real:** Telegram y email llegaron en 0,5 s y 3,0 s (en dos corridas).
  - Telegram: llega al grupo correcto, en HTML, con número, cliente, pago con vuelto y total. Un cliente `Ana <b>& Cía</b>` y las notas `<2>` llegan escapados.
  - Email: llega a los 2 destinatarios, con asunto y link a la consola.
  - En la cola, los dos quedan `sent` con 1 intento.
- **Fallas:** con Telegram en 500, el aviso queda `pending` y se envía solo en el 2º intento (~30 s). Con el email en 403, queda `failed` al primer intento, con "403: The domain is not verified" visible en la consola.
- **Atomicidad:** un pedido rechazado (409 `price_changed`) no deja avisos, y todo pedido de la tienda tiene su aviso.
- **Desvincular Telegram:** el siguiente pedido avisa solo por email.
- **Aislamiento:** otra organización arranca sin canales ni avisos.
- **Dos instancias de la API** (3000 y 3001) despachando la misma cola de 40 avisos: **40 enviados, 0 duplicados**.
- **UI con Playwright (1440 y 390 px):**
  - El panel arranca "Sin configurar".
  - "Conectar Telegram" muestra las instrucciones, y la vinculación aparece sola al llegar el `/start`.
  - El email con `ñ` muestra un mensaje que nombra el email.
  - Los emails válidos se guardan y la prueba sale por los dos canales.
  - "Últimos avisos" muestra Enviado ×2.
  - Sin scroll horizontal a 390 px.

  El único error de consola del navegador fue el 400 del email con `ñ`, que la prueba provoca a propósito.
- **Regresión:** `stress:writes` OK (371 escrituras) con el despachador activo, `check:consistency` OK, sin errores en el log de la API. Builds OK.
- Screenshots en `docs/visual-qa/7.4/`.

**No verificado:** el envío real contra `api.telegram.org` y Resend, porque hace falta el token del bot y la cuenta con dominio verificado. El formato de las llamadas sigue la documentación de ambas APIs. Al configurarlos, el botón **Enviar mensaje de prueba** lo confirma en un paso.

**Nota de proceso:** la migración 010 se aplicó antes de tomar el `pg_dump`. Es solo aditiva (tablas nuevas), y el backup se tomó inmediatamente después (`~/gastronexo-backups/post-010-mision-7.4-*.dump`).

## Pendientes

- Pedidos cargados desde la consola: hoy no avisan. Se podría agregar si el comercio lo pide.
- Avisar también los cambios de estado al **cliente**: requiere sus datos de Telegram o email y su consentimiento. Queda para otra misión.
- Limpieza de la cola: las filas `sent` y `failed` quedan como historial. Con volumen alto conviene purgar las de más de 90 días.
- Bot por organización (marca propia): hoy hay un único bot por instalación.
