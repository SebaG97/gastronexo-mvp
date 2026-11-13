# Misión 9.1 - Pedidos: tablero por columnas, detalle en panel y uso desde el celular

## Objetivo

Que el operador maneje los pedidos con pocos toques, también desde el celular. Antes había una tabla de 10 columnas (cortada en celular), con el detalle y el formulario abajo de la lista, y un botón de próximo paso que se mezclaba con "Cancelar".

## Cómo queda

**Tablero (pantalla principal de Pedidos):**
- **Escritorio:** cinco columnas: Nuevos, Confirmados, En preparación, Listos y Cerrados hoy (entregados y cancelados del día).
- **Celular:** pestañas con contador y una sola columna.
- **Tarjetas** con número, hace cuánto entró, cliente, canal, retiro o envío, pago, productos y total.
- **Marcas visuales:**
  - borde naranja para los pedidos nuevos que llegaron por la tienda;
  - "Entrega hoy" en amarillo;
  - "Atrasado (dd/mm)" en rojo, con borde rojo en la tarjeta.
- **Orden:** primero lo atrasado y lo de hoy; después, lo más viejo.
- **Botón del próximo paso en cada tarjeta:** Confirmar → Empezar preparación → Marcar listo → Entregado.
  - Si hay un solo depósito, la confirmación lo usa sola.
  - Si hay varios, abre el detalle para elegir.
  - Si falta stock, abre el detalle con el aviso.
- **Filtros:** búsqueda por número, cliente o producto, y chips de entrega: Todas, Atrasados (con contador), Hoy y Mañana.
- **Actualización:** el tablero se refresca solo cada 30 s, y al instante cuando entra un pedido de la tienda.

**Detalle (panel lateral en escritorio, pantalla completa en celular):**
- **Contacto directo:**
  - **WhatsApp**, con el número convertido a 595 y un mensaje con el número de pedido;
  - **Llamar**;
  - **Mapa**, si es envío.
- **Datos:** entrega, fecha pedida, dirección, pago (con vuelto), depósito y notas.
- **Productos:** lista con cantidades, totales e historial.
- **Pie fijo:** botón grande con el próximo paso, más "Editar" y "Cancelar pedido".
- **Cancelar** abre una ventana (en celular, una hoja desde abajo):
  - Motivos rápidos: el cliente lo canceló, sin stock, no se pudo contactar, duplicado u otro, más un detalle opcional.
  - El motivo queda en el historial.

**Otros cambios:**
- **Nuevo y editar pedido:** se abren en un panel. El botón de guardar muestra el total.
- **Historial:** pestaña con la lista completa, búsqueda y filtros de estado y canal. En celular, filas compactas.
- **Avisos:** cortos y flotantes ("PED-000010: en preparación."), en lugar de mensajes que mueven la página.

## Servidor

- **`GET /api/orders/board`:**
  - una sola consulta con los pedidos activos y los entregados o cancelados hoy;
  - cada pedido trae el resumen de productos (`itemsPreview`), el teléfono y las fechas en `YYYY-MM-DD`;
  - "hoy" se calcula en la zona horaria del negocio (`BUSINESS_TIMEZONE`, por defecto `America/Asuncion`);
  - tope de 300 pedidos; si se pasa, avisa que se use el Historial.
- **`PATCH /api/orders/:id/status`:** acepta `note` (motivo, hasta 300 caracteres), que se guarda en el historial.
- **Migración `014_order_status_note.sql`:** `order_status_history.note`. El historial sigue siendo solo de agregar.

## Componentes nuevos

- `shared/components/Modal.tsx`: ventana sobre `<dialog>` nativo, que maneja el foco, cierra con Escape o tocando el fondo y deja el fondo inactivo. Tiene dos variantes:
  - `drawer`: panel lateral en escritorio, pantalla completa en celular;
  - `dialog`: centrada en escritorio, hoja desde abajo en celular.
- `features/orders/OrdersBoard.tsx`, `OrderDetailSheet.tsx` y `orders-format.ts`, con textos, formatos y links de WhatsApp, teléfono y mapa.
- `shared/styles/orders-board.css`, para modo claro y oscuro.
- `Button` suma la variante `danger`.

## Verificación

**Playwright** (26 de 26 OK).

Escritorio, 1440 px:
- 5 columnas y sin pestañas;
- sin scroll horizontal;
- lo atrasado aparece marcado y primero;
- el filtro Atrasados y la búsqueda funcionan;
- el botón de la tarjeta mueve el pedido a la columna siguiente y muestra el aviso;
- el detalle abre como panel lateral, con WhatsApp (`wa.me/595…`) y Llamar;
- el botón grande muestra el próximo paso y Escape cierra el panel;
- cancelar guarda el motivo en el historial;
- Nuevo pedido abre en un panel con el total en el botón;
- el Historial lista los pedidos.

Celular, 390 px táctil:
- pestañas visibles y una sola columna;
- sin scroll horizontal;
- la pestaña Listos muestra su columna;
- el detalle ocupa toda la pantalla, con el botón del próximo paso visible abajo;
- "Entregado" pasa el pedido a Cerrados hoy;
- cancelar sube como hoja desde abajo.

En las dos: sin errores de consola.

**Regresión:**
- recorrido de las 12 secciones a 3 anchos (8.4, adaptado: Pedidos ya no tiene tabla);
- compra en la tienda en celular y escritorio, con los pedidos llegando a la consola (8.5);
- `stress:writes` y `check:consistency` OK.

**Hallazgo corregido durante la prueba:** en celular, unos márgenes negativos y la grilla de la página ensanchaban el documento 20 px. Por eso las ventanas salían más grandes que la pantalla. Las pruebas anteriores medían contra `innerWidth`, que con emulación móvil también crece, y no lo detectaban. Ahora miden contra `clientWidth`.

**Capturas** en `docs/visual-qa/9.1/`: tablero, detalle, cancelar, nuevo, historial, modo oscuro y las pantallas de celular.

## Próximas etapas

- **9.2:** nuevo pedido paso a paso (cliente con buscador, productos con buscador y botones + y −, entrega, revisar).
- **9.3:** comanda imprimible para la cocina.
