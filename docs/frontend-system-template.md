# Frontend System Template

## Alcance

Template para aplicaciones React de consola operativa con Vite y TypeScript. Su objetivo es entregar una base consistente para módulos CRUD, tableros, alertas y flujos de trabajo.

## Estructura

```text
frontend/src/
  app/                 composición de la aplicación y shell
  features/            módulos de dominio autocontenidos
  shared/components/   componentes reutilizables de interfaz
  shared/styles/       tokens y estilos transversales
```

## Convenciones

- Mantener cada módulo en `features/<dominio>/`.
- Centralizar componentes reutilizables en `shared/components/`.
- Importar tokens globales una sola vez desde `main.tsx`.
- Usar `data-theme="light|dark"` en el elemento raíz para alternar temas.
- Nombrar variables CSS con `--sys-*`.
- Mantener las vistas como componentes pequeños y explícitos; evitar abstracciones prematuras.

## Base de interfaz

1. `SystemShell` gestiona navegación, topbar y cambio de tema.
2. `Button`, `Panel` y `StatusBadge` resuelven patrones visuales frecuentes.
3. Cada vista define su contenido dentro de `main.page`.
4. La acción principal se entrega desde el contexto del módulo hacia la topbar.

## Extensión recomendada

Para convertir placeholders en módulos productivos:

1. Agregar tipos y servicios del dominio dentro del feature.
2. Incorporar listados y formularios manteniendo los componentes compartidos.
3. Añadir estado de carga, vacío y error explícitos.
4. Integrar navegación por URL cuando el MVP requiera deep linking.
