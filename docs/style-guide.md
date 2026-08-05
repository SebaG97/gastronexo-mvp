# Ops Console Style Guide

## Propósito

Esta guía define un lenguaje visual neutral y reusable para consolas operativas. No pertenece a una industria o marca específica: cada producto puede aplicar su identidad sobre esta base.

## Principios

- Aspecto profesional y utilitario de consola.
- Densidad compacta: priorizar datos, contexto y acciones directas.
- Sin fondos decorativos, hero sections ni ornamentos sin función.
- Una acción primaria por región: topbar, encabezado o panel.
- El amarillo se reserva exclusivamente para advertencias.
- Los paneles utilizan radio de `8px`.

## Tokens

Los tokens se definen con el prefijo `--sys-*` y soportan tema claro y oscuro mediante `data-theme="light|dark"`.

| Grupo | Tokens principales |
| --- | --- |
| Superficies | `--sys-bg`, `--sys-surface`, `--sys-surface-raised` |
| Contenido | `--sys-text`, `--sys-text-muted`, `--sys-border` |
| Acción | `--sys-primary`, `--sys-primary-hover`, `--sys-primary-text` |
| Estados | `--sys-success`, `--sys-warning`, `--sys-danger` |
| Estructura | `--sys-radius`, `--sys-sidebar-width`, `--sys-shadow` |

No introducir variables de producto como `--parks-*`; las personalizaciones deben mapearse a los tokens del sistema.

## Componentes

### Shell

El shell se compone de sidebar persistente, topbar contextual y área de contenido. La sidebar contiene navegación de primer nivel; la topbar contiene contexto y una única acción primaria.

### Paneles

Los paneles agrupan información relacionada. Deben usar borde sutil, fondo de superficie, radio de `8px` y encabezado opcional.

### Botones

Usar `primary` para la acción principal de una región y `secondary` para acciones de apoyo. Evitar múltiples llamadas visuales equivalentes.

### Estados

- Éxito: verde.
- Advertencia: amarillo.
- Riesgo/error: naranja o rojo.
- Información: azul tenue.

## Tipografía y espaciado

Usar una tipografía sans-serif de sistema, tamaños legibles y espacios de 8, 12, 16, 24 y 28px. Las tablas, KPIs y filas operativas deben favorecer números tabulares y lectura rápida.
