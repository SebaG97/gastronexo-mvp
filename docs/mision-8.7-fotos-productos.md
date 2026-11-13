# Misión 8.7 - Fotos de productos desde la consola

## Objetivo

Hasta ahora la foto de un producto era solo un link a internet. El cliente nos pasó 129 fotos sin nombre, y él mismo tiene que poder cambiarlas sin depender de nosotros. Ahora la foto se sube desde la ficha del producto.

## Cómo se usa

En **Productos → Nuevo / Editar**, en "Foto para la tienda":

- **Subir foto / Cambiar foto:** elegís un JPG, PNG o WebP (hasta 15 MB). Se ve la vista previa y se sube al guardar.
- **Quitar foto:** el producto vuelve a mostrar la inicial en la tienda.
- **Usar un link de internet en su lugar:** sigue disponible, plegado, para quien prefiera un link.

## Qué hace el servidor

- **Procesamiento** (`backend/src/media/product-images.ts`, con [sharp](https://sharp.pixelplumbing.com/)):
  - decodifica la imagen de verdad, así que un archivo que no es foto se rechaza aunque diga `image/jpeg`;
  - la endereza según el EXIF y la achica a 1000 px de lado mayor;
  - la guarda como WebP: una foto de cámara de 1,7 MB queda en unos 25 KB;
  - **quita los metadatos** (GPS, datos de la cámara).
- **Rechazos:**
  - SVG (puede llevar scripts) y HEIC del iPhone, con un mensaje que dice qué hacer;
  - más de 15 MB → 413;
  - imágenes gigantes o "bombas" de descompresión, por un límite de píxeles.
- **Endpoints** (`modules/products/product-images.routes.ts`):
  - `POST /api/products/:id/image`, con la foto como cuerpo, sin multipart;
  - `DELETE /api/products/:id/image`.
  - Mismos roles que editar un producto. Límite de 60 subidas por minuto.
- **Foto anterior:** al cambiar, quitar o reemplazar por un link, se borra. Solo se borra si ya no la usa ningún producto y es de la misma organización. Se hace después del commit: si falla, queda un archivo huérfano, nunca un producto sin foto.
- **Aislamiento entre negocios:** las claves son `products/<organización>/<uuid>.webp` y las genera el servidor. Un negocio no puede usar ni borrar fotos de otro: devuelve 400 al intentar asignarla y 404 al intentar subirla a un producto ajeno.

## Dónde se guardan (`backend/src/media/storage.ts`)

| `MEDIA_STORAGE` | Uso | URL guardada |
| --- | --- | --- |
| `local` (default) | Desarrollo. Archivos en `backend/uploads/` (ignorado por git), servidos por la API en `/api/uploads/...` con caché larga. | Relativa: `/api/uploads/products/...`. La consola y la tienda le anteponen la URL de la API (`shared/lib/media.ts`). |
| `s3` | Producción: **DigitalOcean Spaces** o cualquier almacenamiento compatible con S3. | Absoluta: `S3_PUBLIC_BASE_URL/products/...` (el CDN del Space). |

En App Platform el disco se borra en cada deploy, por eso `.do/app.yaml` ya usa `s3`. Cómo crear el Space y sus claves: `docs/despliegue-digitalocean.md`, paso 2. Si falta una variable de S3, la API no arranca y dice cuál.

## Otros arreglos

- **Formulario de productos:** se reiniciaba (y perdía lo escrito) cada vez que la vista se volvía a dibujar, porque recibía un objeto nuevo en cada render. Ahora recibe uno estable.
- **Campos de texto largo** (descripción, notas): usaban la letra monoespaciada del navegador y no tenían el estilo de los demás campos. Ahora son iguales a los inputs.

## Verificación

**API** (30 pruebas, almacenamiento local), todas OK:

| Caso | Resultado |
| --- | --- |
| Subir un JPG de cámara | 201, WebP de 1000 px, sin EXIF, unas 70 veces más liviano |
| Reemplazar la foto | URL nueva y la anterior se borra |
| Texto disfrazado de JPG, SVG, `text/plain` | 415 |
| Archivo de 16 MB | 413 |
| Después de esos rechazos | La foto vigente sigue |
| `../../.env`, `%2F..`, claves inválidas | 404 |
| Subir a un producto de otra organización | 404 |
| Asignar una foto de otra organización (al editar o crear) | 400 |
| Cambiar a un link externo | 200 y se borra la subida |
| `javascript:` como link | 400 |
| Guardar sin tocar la foto | No la cambia |
| Tienda pública | Devuelve la foto |
| 6 subidas simultáneas al mismo producto | Todas 201; queda un solo archivo y es el del producto |
| Quitar la foto | Sin foto y archivo borrado |
| Sin sesión | 401 |

**S3** (simulado con SeaweedFS en Docker, como un Space), 6 de 6 OK:

- la URL es la pública del bucket;
- se sirve como WebP con caché larga;
- reemplazar y quitar borran el archivo del bucket;
- la API no expone `/api/uploads`.

**Consola** (Playwright, 1440 y 390 px, navegador en inglés), 25 de 25 OK:

- alta con foto;
- un `.txt` muestra un error en español;
- la vista previa aparece antes de guardar;
- al editar se ve la foto guardada;
- se puede cambiar la foto, y la anterior se borra;
- la foto aparece en la tienda;
- se puede quitar la foto;
- sin scroll horizontal;
- sin errores en la consola.

**Regresión:** `stress:writes` OK, `check:consistency` OK y 0 errores en el log de la API.

Screenshots en `docs/visual-qa/8.7/`.

## Pendiente detectado (no es de esta misión)

`npm audit` del backend marcaba vulnerabilidades previas en `fastify`, `fast-jwt`, `fast-uri` y `zod`. **Resuelto en la 8.10** (`docs/mision-8.10-dependencias.md`).
