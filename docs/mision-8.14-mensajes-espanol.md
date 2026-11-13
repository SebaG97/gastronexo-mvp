# Misión 8.14 - Mensajes de validación por defecto en español

## Objetivo

Desde la 8.10 (zod 4), los mensajes de validación que no definimos nosotros salían en inglés, por ejemplo "Too small: expected string to have >=2 characters". La consola valida antes de enviar, así que casi no se veían, pero una integración o un error en el formulario los podía mostrar.

## Cambio

`backend/src/config.ts` activa el idioma español que trae zod 4: `z.config(z.locales.es())`. Ese módulo se importa antes que cualquier esquema, así que aplica a toda la API.

| Antes | Ahora |
| --- | --- |
| Too small: expected string to have >=2 characters | Demasiado pequeño: se esperaba que texto tuviera >=2 caracteres |
| Too big: expected number to be <=60 | Demasiado grande: se esperaba que número fuera <=60 |

Los mensajes propios ("Ya existe un producto con ese nombre…", "Ese color es muy claro…") no cambian.

**Límite:** la traducción es la de zod y algunas frases quedan algo forzadas, por ejemplo "Inválido dirección de correo electrónico". Si molesta, se pueden reemplazar las más visibles con mensajes propios en los esquemas.

## Verificación

- Un producto inválido y un `pageSize` fuera de rango devuelven los mensajes en español.
- Siguen pasando:
  - 8.6 (nombres únicos);
  - 8.12 (sesión en cookie y CSRF);
  - `stress:writes` y `check:consistency`.
