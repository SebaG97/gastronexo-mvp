# Misión 7.3 - Avisos de pedidos nuevos de la tienda en la consola

## Objetivo

Que el comercio se entere enseguida cuando entra un pedido por la tienda online. Hasta 7.2 el único aviso era un contador en el menú, actualizado cada 60 segundos y fácil de pasar por alto.

Esta misión resuelve el aviso **dentro de la consola**, sin servicios externos. El aviso por email o WhatsApp al comercio necesita elegir un proveedor y queda para una misión aparte (ver Pendientes).

## Comportamiento

- La consola consulta cada **20 segundos** los pedidos de la tienda en estado `new`, y también al volver a la pestaña. Al abrir la consola no se anuncia lo que ya estaba.
- Cuando entra un pedido:
  - **Aviso en pantalla** abajo a la derecha (a lo ancho en móvil) con número, cliente, ítems y total, y botón **Ver pedido**, que abre Pedidos con el detalle a la vista. Si entraron varios entre dos consultas, el aviso es uno solo ("3 pedidos nuevos de la tienda") con **Ver pedidos**. Se cierra con la X o solo a los 30 s.
  - **Sonido:** dos tonos cortos generados con Web Audio, sin archivo de audio.
  - **Notificación del navegador** si la pestaña está en segundo plano y el permiso está dado.
  - **Contador en el título de la pestaña**, por ejemplo `(3) Gastronexo | Ops Console`, y el contador del menú.
  - La **lista de Pedidos se recarga sola**, sin parpadeo y sin cerrar un formulario abierto.
- **Campana en la barra superior:** activa o silencia el sonido y las notificaciones. La primera activación pide permiso de notificaciones y hace sonar el tono de prueba. La preferencia se guarda por navegador. Con la campana silenciada, el aviso en pantalla y los contadores siguen funcionando.
- **Bug corregido:** en Pedidos, cambiar el filtro **Canal** no recargaba la lista. Faltaba `channel` en las dependencias del efecto.

## Implementación

- `frontend/src/features/orders/useStorefrontOrderAlerts.ts`: consulta, detección por IDs ya vistos (ventana de 20 pedidos, y el total para ráfagas mayores), sonido, notificación, título, preferencia y reinicio al cambiar de organización.
- `frontend/src/features/orders/OrderAlertToast.tsx` y estilos `.order-toast` en `app.css`, con tokens del sistema para los modos claro y oscuro y `prefers-reduced-motion`.
- `OrdersView`: props `refreshKey` (recarga silenciosa) y `openOrderRequest` (abre el detalle y lo lleva a la vista).
- `SystemShell`: botón de campana con `aria-pressed` y una etiqueta que explica el estado.
- **Sin cambios en el backend.** Usa `GET /api/orders?channel=storefront&status=new`, que ya existía. Es una consulta liviana cada 20 s por consola abierta.

## Verificación

Prueba de punta a punta con Playwright (Chromium) contra la API y Vite locales, en una organización nueva cargada con `seed-storefront-demo.mjs`. Los pedidos se crean por la API pública de la tienda:

- 1440 px y 390 px: al abrir la consola no aparece aviso. Un pedido de la tienda dispara el aviso a los 18,3 s, con el número correcto. El título muestra `(n)`. La lista se actualizó sola. **Ver pedido** abre el detalle correcto y cierra el aviso.
- Ráfaga de 3 pedidos simultáneos → un solo aviso, "3 pedidos nuevos de la tienda".
- La campana arranca activada, se silencia, y el silencio se mantiene al recargar.
- Cambiar el filtro Canal dispara la recarga (`channel=admin`).
- Sin errores en la consola del navegador. `npm run build` del frontend OK.
- Screenshots en `docs/visual-qa/7.3/`.

No verificado automáticamente: que el sonido se escuche (el navegador headless no tiene salida de audio) y la notificación del sistema operativo con la pestaña oculta. Conviene probar ambos a mano en el navegador que use el comercio.

Al repetir la prueba seguida, la API pública devolvió `429` desde el noveno pedido. Es el límite de la tienda de 7.2 (8 pedidos cada 10 minutos por IP) funcionando. La corrida final se hizo con la API recién iniciada.

## Limitaciones y pendientes

- **Hace falta tener la consola abierta.** Con el navegador cerrado no hay aviso. Para eso falta el aviso externo:
  - **Email:** necesita un proveedor SMTP o transaccional (Resend, SendGrid, Amazon SES, etc.) y su clave.
  - **WhatsApp:** la API oficial de WhatsApp Business (Meta) requiere un número verificado y plantillas aprobadas. Una alternativa simple es un webhook hacia una herramienta tipo n8n/Make.
- Con la pestaña en segundo plano por varios minutos, Chrome espacia los temporizadores a ~1 por minuto. El aviso puede tardar hasta un minuto, y al volver a la pestaña se consulta enseguida.
- Algunos navegadores móviles no muestran `new Notification()` fuera de un service worker. Ahí quedan el aviso en pantalla, el sonido y el título.
- Si se necesita inmediatez real o muchas consolas abiertas, conviene pasar de consultas periódicas a Server-Sent Events.
