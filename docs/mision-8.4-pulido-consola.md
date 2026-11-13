# Misión 8.4 - Pulido de la consola (hallazgos H5, H8–H10, H12, H14–H16)

## Objetivo

Cerrar los hallazgos de UX, accesibilidad y texto que quedaban de la verificación visual de la 5.3 (tabla en `docs/functional-readiness-plan.md`).

## Cambios

| # | Hallazgo | Resolución |
| --- | --- | --- |
| H5 | Badge "Base funcional lista" en módulos vacíos | Desde la 8.3 ningún módulo usa el placeholder, así que se eliminó `PlaceholderModule.tsx`, que ya era código muerto. |
| H8 | Los avisos nativos de validación salen en el idioma del navegador | `shared/lib/spanish-validation.ts` se instala al arrancar y traduce **todos** los avisos (campo vacío, email, longitud, mínimo y máximo, fechas, enteros, formato) para la consola y la tienda, sin tocar cada formulario. Se limpia al escribir. Ingreso y registro ya tenían validación propia desde la 8.1. |
| H9 | Sin foco visible con teclado en botones, menú y selects | `:focus-visible` con contorno de 2 px del color de la marca en botones, links y selects, y anillo en los selects (como los inputs). |
| H10 | Dos `h1`, select sin etiqueta, nombre de la organización repetido, menú sin `aria-current` | El título de la barra pasa a ser un `p` decorativo (un solo `h1` por pantalla). "Organización activa" es un `<label>` del select. Se quitó el nombre repetido. El menú marca la sección activa con `aria-current="page"`. |
| H12 | La celda Acciones con `display: flex` desalinea el borde de la fila | La celda vuelve a ser `table-cell` y los botones van en línea (en móvil pueden pasar a otra línea). |
| H14 | Mezcla de tuteo y voseo | Todo en voseo: "Gestioná", "Seleccioná", "Agregá", "Revisá". También en los mensajes de la API. |
| H15 | `depÃ³sito` en el error de Compras | Corregido. No quedan textos con mojibake en `backend/src` ni en `frontend/src`. |
| H16 | Faltan tildes | 39 reemplazos en textos visibles de Pedidos, Clientes, Compras, Ventas y en los mensajes de la API: "En preparación", "Número", "Ítems", "Depósito", "Página", "Razón social", "Teléfono", "catálogo", "opción", "Transición… inválida", etc. Se encontraron con un escáner que solo mira textos visibles (contenido JSX y strings), no identificadores ni comentarios. |

## Decisiones del cliente (cerradas en la 8.6)

- **H13:** no se permiten productos con el mismo nombre. Ver `docs/mision-8.6-decisiones-cliente.md`.
- **H17:** la moneda es el guaraní (`Gs.`).

## Verificación

Playwright contra la API y Vite locales, con la cuenta demo y el navegador **en inglés**:

- **Las 12 secciones a 1440, 1024 y 390 px:** un solo `h1` por pantalla, `aria-current` en la sección correcta y sin scroll horizontal en ninguna.
- El selector de organización tiene una etiqueta accesible.
- **H12:** la celda de acciones es `table-cell` y termina en el mismo píxel que el resto de la fila.
- **H8:** "Nuevo producto" con el nombre vacío muestra el aviso "Completá este campo.", y al escribir se limpia.
- **H9:** el control enfocado con Tab muestra un contorno sólido de 2 px.
- Pedidos muestra "Buscar por número", "Número", "Ítems", "Depósito" y "Página".
- Sin errores en la consola del navegador. Los builds de backend y frontend pasan.
- Screenshots de todas las secciones en `docs/visual-qa/8.4/`.
