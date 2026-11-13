# Misión 8.13 - Fotos recortadas alrededor de la verdura

## Objetivo

Resolver lo observado en la 8.9: las fotos de estudio son horizontales, con la bolsa al centro y mucho fondo, así que en las tarjetas cuadradas del catálogo el producto se veía chico.

## Cambio

`npm run vista-previa` recorta cada foto de fondo blanco en un cuadrado centrado en la verdura (`scripts/vista-previa-cliente.mjs`, `squareAroundProduct`). El recorte se hace después de corregir el color:

1. Busca los píxeles con color: la bolsa y el fondo son blancos o grises, la verdura no.
2. Toma la caja que los contiene, descartando el 2% de puntos sueltos en cada borde, y le suma un 50% de aire para que entre la bolsa.
3. El lado mínimo es el 60% del lado corto de la foto. Así las verduras pálidas, como la cebolla o el ajo, que casi no tienen color para detectar, no quedan demasiado justas.
4. Si no encuentra color, recorta el cuadrado central.

**Uso:**
- `npm run vista-previa -- --rehacer-fotos` vuelve a subir las fotos de productos que ya tenían una.
- La anterior se borra sola (8.7), así que queda una foto por producto.

**Foto del mix:** "Mix de morrones picados" pasó de IMG_7196 (tres bolsas una al lado de la otra, que el cuadrado cortaba) a IMG_7204 (las mismas bolsas apiladas).

**Fotos de exterior:** quedan como están. Son verticales y con el producto centrado en la mano.

Esto es solo para preparar el material del cliente. Las fotos que se suben desde la consola (8.7) no se recortan solas, porque cada usuario elige el encuadre que quiere.

## Verificación

- Las 18 fotos, una al lado de la otra: `docs/visual-qa/8.13/fotos-recortadas.jpg`.
- **Tienda a 1440 y 390 px:** 18 productos con foto, sin scroll horizontal, sin errores y con una compra de prueba completa. Capturas en `docs/visual-qa/8.13/`.
- En disco quedan exactamente 18 fotos de productos de esa organización: las anteriores se borraron.
