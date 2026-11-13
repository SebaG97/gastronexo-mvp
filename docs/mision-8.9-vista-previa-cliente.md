# Misión 8.9 - Vista previa de la tienda del cliente

## Objetivo

Mostrarle a Soluciones Gastronómicas cómo quedaría su tienda, con sus productos, sus fotos y su logo. Así es más fácil que nos pase lo que falta: precios, forma de venta y las fotos que no pudimos identificar.

## Cómo se arma

```
npm run dev            # en otra terminal
npm run vista-previa
```

`scripts/vista-previa-cliente.mjs` lee el material del cliente desde `material-cliente/` (ignorado por git) y arma, contra la API local:

- **Cuenta:** `vista-previa@gastronexo.test` / `vista-previa-gastronexo`, organización **Soluciones Gastronómicas**. Tienda en `http://localhost:5173/tienda/soluciones-gastronomicas`.
- **Catálogo:** 18 productos en 5 categorías (Rodajas, Cubos, Tiras y juliana, Picados y rallados, Mixes), cada uno con su foto. Incluye solo lo identificado con seguridad o confirmado por el cliente; ver `material-cliente/identificacion-fotos.csv`.
- **Fotos:** las de fondo blanco se corrigen antes de subirlas (el fondo salía azulado). Se mide el fondo y se ajusta cada canal a blanco neutro.
- **Marca:** el logo blanco y, como portada, la foto del surtido (IMG_7227) corregida y recortada a 16:10.
- **Datos de ejemplo:**
  - **precios de ejemplo**, y cada producto lo dice en su descripción ("Precio de ejemplo, a confirmar.");
  - stock de 30 unidades;
  - una "Zona de ejemplo" de envío;
  - un aviso en la cabecera: "Vista previa: precios, zonas y horarios son de ejemplo".

Es repetible: lo que ya existe (productos por nombre, fotos, logo, portada) no se duplica.

## Lo que falta del cliente para el catálogo real

1. **Precios** de cada producto.
2. **Forma de venta:**
   - si es por bolsa, de cuántos gramos;
   - si es por kilo, se cambia la unidad.
   Hoy figura "la unidad".
3. **Cortes:**
   - **Productos separados** (como en la vista previa): "Zanahoria en cubos", "Zanahoria en rodajas"…
   - **Un producto con opciones de corte:** "Zanahoria" con cubos, rodajas o rallada. El sistema ya lo soporta; ver Tipos de corte.
4. **Fotos dudosas**, que quedaron afuera:
   - ramitos blancos (¿coliflor o repollo blanco?);
   - tiras pálidas (¿cebolla blanca en juliana o repollo?);
   - hojas verdes (¿lechuga o repollo?).
5. Contacto, dirección de retiro, horarios, zonas de envío con su costo y pedido mínimo.
6. Color de la cabecera: ver `docs/visual-qa/8.8/comparacion-colores.png`. La vista previa usa el verde de siempre.

## Verificación

**Capturas y compra de prueba** (Playwright), todas OK:

- en 1440 y 390 px: 18 productos, todos con foto cargada, sin scroll horizontal y sin errores de consola;
- compra de prueba completa con retiro → `PED-000001`.

**Repetibilidad:** al correr el script por segunda vez, los 18 productos figuran como "ya tenía foto" y siguen siendo 18 en la base.

**Capturas** en `docs/visual-qa/8.9/`:
- `1440-portada.png` y `390-portada.png`;
- `1440-catalogo.png` y `390-catalogo.png`;
- `*-completa.png`, la página entera;
- `1440-confirmacion.png`.

## Observación

Las fotos de estudio son horizontales con la bolsa en el centro y mucho fondo, así que en las tarjetas cuadradas del catálogo el producto se ve algo chico. Se puede mejorar recortando cada foto más cerca de la bolsa. Conviene hacerlo con las fotos definitivas, cuando el cliente confirme cuáles usa.
