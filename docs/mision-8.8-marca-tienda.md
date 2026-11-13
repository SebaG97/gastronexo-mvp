# Misión 8.8 - Marca en la tienda: logo, portada y color

## Objetivo

Que la tienda se vea como la del cliente (Soluciones Gastronómicas) y no como una plantilla, y que el dueño pueda cambiar su marca desde la consola.

## Cómo se usa

En **Tienda online → Marca**:

- **Vista previa:** muestra la cabecera con el color, el logo y la portada como van a quedar.
- **Logo:** Subir, Cambiar y Quitar. Va sobre la cabecera de color, así que conviene la versión blanca con fondo transparente. Sin logo, la tienda muestra el nombre.
- **Foto de portada:** Subir, Cambiar y Quitar. En escritorio aparece al lado de la frase y en celular debajo.
- **Color de la cabecera:** cuatro opciones (Verde huerta, que es el de siempre, Carbón, Terracota y Berenjena) y "Otro" con un selector libre.
  - Un color demasiado claro se rechaza, porque el texto blanco de la cabecera no se leería.
  - El color también se usa en los botones principales de la tienda.

Las imágenes se guardan apenas se eligen, sin pasar por el botón Guardar de "Datos y reglas de venta". Guardar esos datos no toca la marca.

## Servidor

- **Migración `013_storefront_branding.sql`:** `storefront_settings` suma `logo_url`, `cover_url` y `brand_color`, con un CHECK para el formato `#rrggbb`.
- **Endpoints** (`modules/storefront/storefront-branding.routes.ts`, solo dueño o administrador):
  - `POST` y `DELETE` en `/api/storefront/logo` y `/api/storefront/cover`;
  - `PUT /api/storefront/brand-color`.
- **Procesamiento:**
  - **Logo:** conserva la transparencia y **recorta el margen vacío**. El PNG del cliente era de 2000×2000 con mucho aire alrededor; quedó en 509×400 y pasó de 369 KB a 46 KB.
  - **Portada:** como las fotos de productos, pero hasta 1600 px.
- **Color:** se exige contraste ≥ 4.5:1 (WCAG AA) con el texto claro de la cabecera. Solo se acepta `#rrggbb`, así que no se puede inyectar CSS.
- **Almacenamiento y limpieza:** igual que la 8.7, con claves `brand/<organización>/<uuid>.webp`. La imagen anterior se borra al reemplazarla o quitarla, solo si ningún producto ni otra configuración la usa. Una organización no puede usar como foto de producto una imagen de marca de otra.
- **Tienda pública:** la API devuelve `logoUrl`, `coverUrl` y `brandColor`.

## Material del cliente usado en la demo local

- **Logo:** `Soluciones Gastronomicas - Blanco (Sin fondo).png`.
- **Portada:** la foto del surtido (IMG_7227) con **corrección de color** (el fondo blanco salía azulado) y recortada a 16:10, sin el borde del estudio que asomaba a la derecha.
  - La corrección mide el fondo y ajusta cada canal para que quede blanco neutro.
  - El mismo proceso se aplica a las fotos de productos en la 8.9.

## Ícono de la pestaña

No se generó desde el logo. Tiene textos y trazos finos, y a 16–32 px no se lee. Conviene pedirle a quien hizo el logo una versión simplificada, por ejemplo solo el gorro de chef, y agregarla cuando esté.

## Verificación

**API**, 19 de 19 OK:

- logo: WebP con transparencia, margen recortado, liviano;
- portada: WebP de 1600×1000;
- reemplazar borra la imagen anterior;
- la tienda pública devuelve logo y portada;
- se rechazan un color claro (amarillo), uno sin formato y un intento de inyectar CSS;
- un color oscuro se guarda en minúsculas;
- `null` vuelve al color de siempre;
- guardar los datos de venta no borra la marca;
- un SVG → 415;
- otra organización sube su logo sin tener la tienda configurada y no toca el de la demo;
- no se puede usar la portada de otro negocio como foto de producto;
- quitar el logo borra el archivo;
- sin sesión → 401.

**Pantalla** (Playwright), 18 de 18 OK:

- el panel Marca muestra la vista previa y los botones Cambiar y Quitar;
- un color claro muestra el aviso de contraste;
- cada uno de los 4 colores, en la tienda a 1440 y 390 px: cabecera del color, logo y portada cargados, sin scroll horizontal;
- el logo tiene el nombre de la tienda como texto alternativo;
- el panel en celular no tiene scroll horizontal;
- sin errores en la consola.

**Regresión:** `stress:writes` OK, `check:consistency` OK y 0 errores en el log.

**Screenshots** en `docs/visual-qa/8.8/`:
- `comparacion-colores.png`: los 4 colores lado a lado, escritorio y celular;
- `1440-consola-panel-marca.png`.
