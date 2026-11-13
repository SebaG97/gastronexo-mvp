# Misión 8.5 - Tienda: compra real por la interfaz

## Objetivo

Antes de hacer retoques de estilo a la tienda (pendiente desde la 7.2), recorrerla como un cliente y encontrar problemas concretos de uso o de diseño, en lugar de rediseñarla por gusto.

## Recorrido (Playwright, cuenta demo, navegador en inglés)

En **celular (390 px, táctil)** y **escritorio (1440 px)**:

1. Catálogo → "Agregar" una banana (por kilo) y subir la cantidad con el stepper.
2. Cebolla blanca → "Elegir corte" → ficha → Juliana (con recargo) → "Agregar Gs. 4.000".
3. Carrito → si no llega al mínimo, sumar desde el carrito → "Finalizar pedido".
4. Datos (nombre y WhatsApp) → entrega (celular: **envío** con zona y dirección; escritorio: **retiro**) → pago en efectivo → revisión → "Enviar pedido de Gs. …".
5. Confirmación con número `PED-`, resumen, entrega, pago y botón de WhatsApp.

## Resultado

- **Compra completa en los dos anchos:** `PED-000002` (envío, Gs. 62.750 con Gs. 10.000 de envío) y `PED-000003` (retiro, Gs. 52.750).
- Los dos llegaron a la consola como **nuevos de la tienda**: el de celular con `fulfillmentType = delivery` y su costo de envío, el de escritorio como retiro.
- **Sin scroll horizontal** en catálogo, ficha, carrito, los 4 pasos del checkout y la confirmación.
- **Sin errores** en la consola del navegador.
- En celular, al bajar por el catálogo siguen a mano la barra fija **"Ver pedido"** al pie y las categorías pegadas arriba.

**Conclusión:** no apareció ningún defecto de uso ni de diseño, así que **no se cambió código**. Los retoques que queden son de gusto (marca, fotos, tipografía) y conviene definirlos con el cliente. Por ejemplo, con fotos reales de los productos en lugar de las iniciales.

Screenshots de cada paso en `docs/visual-qa/8.5/` (`390-*` y `1440-*`).
