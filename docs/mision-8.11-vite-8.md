# Misión 8.11 - Frontend a Vite 8

## Objetivo

Cerrar lo que quedó pendiente en la 8.10: las alertas de `npm audit` en las herramientas de desarrollo del frontend (Vite 5 y esbuild).

## Cambios

| Paquete | Antes | Después |
| --- | --- | --- |
| `vite` | 5.4.21 | 8.3.5 |
| `@vitejs/plugin-react` | 4.7.0 | 6.1.2 |

- No hizo falta tocar código ni `vite.config.ts`.
- Vite 8 compila con Rolldown: el build pasó de ~4 s a ~1,2 s y los archivos generados son del mismo tamaño.
- Requiere Node 20.19+ o 22.12+. El proyecto ya exige Node 22 (`engines`), igual que App Platform.
- **`npm audit` del frontend: 0 vulnerabilidades**, contando también las herramientas de desarrollo. El backend ya estaba en 0 desde la 8.10.

## Verificación

Todo con el servidor de desarrollo de Vite 8 (`VITE v8.3.5`):

- **Recorrido de la consola (8.4):**
  - 12 secciones a 1440, 1024 y 390 px, con un solo `h1`, `aria-current` correcto y sin scroll horizontal;
  - avisos de validación en español y foco visible.
- **Compra en la tienda (8.5):** en celular con envío y en escritorio con retiro; los dos pedidos llegan a la consola.
- **Fotos de productos (8.7):** alta, cambio y quita, y la foto se ve en la tienda.
- **Marca (8.8):** panel, aviso de contraste y los 4 colores en la tienda a 1440 y 390 px.
- **Vista previa del cliente (8.9):** 18 productos con foto y una compra de prueba.
- En todos los casos, sin errores en la consola del navegador. `npm run build` pasa.

## Nota para el que levante el entorno

Si queda abierto un Vite viejo en el puerto 5173, el nuevo no arranca ("Port 5173 is already in use"). Hay que cerrarlo antes, o usar `npm run dev`, que levanta y cierra todo junto.
