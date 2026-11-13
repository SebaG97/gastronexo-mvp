# Misión 8.1 - Registro desde la pantalla de ingreso (H7)

## Objetivo

Que un negocio nuevo pueda crear su cuenta y su organización desde la pantalla de ingreso, sin `curl`. Cierra el hallazgo **H7** de la 5.3. Es parte de la puesta a punto local (misiones 8.x).

## Cambios

- **Pantalla de ingreso con dos modos:** *Ingresar* y *Crear cuenta para tu negocio*. El registro pide nombre, email, contraseña (mínimo 10 caracteres), nombre del negocio y **link de la tienda**.
  - El link se arma solo a partir del nombre ("Verdulería Don José" → `verduleria-don-jose`) y se puede editar.
  - Al crear la cuenta entra directo a la consola como dueño. Usa `POST /api/auth/register`, que ya existía y tiene límite de 5 por hora por IP desde la 7.1.
- **Errores por campo:**
  - **Email ya registrado:** el error aparece en el email, con la sugerencia de ingresar.
  - **Link ya usado:** el error aparece en el link.
  - **429:** se muestra el mensaje de la API.
- **H8 resuelto en ingreso y registro:** los formularios usan validación propia en español (`noValidate`) en lugar de los globos del navegador, que salen en su idioma. Los campos inválidos se marcan con `aria-invalid` y el error se asocia con `aria-describedby`. El resto de los formularios queda para la misión de pulido.
- Sin cambios en el backend.

## Verificación

Playwright contra la API y Vite locales, con el navegador **en inglés** para comprobar que no aparecen globos nativos:

- Ingreso vacío → "Escribí tu email." / "Escribí tu contraseña.".
- Registro vacío → 5 errores por campo y **ningún** request a la API.
- El link se arma solo desde el nombre con tildes.
- Email `josé@…` y contraseña corta → errores claros por campo.
- El registro válido entra a la consola con el negocio activo, y *Tienda online* muestra `/tienda/<link elegido>`.
- Email repetido → error en el email. Link repetido → error en el link.
- Se puede volver a ingresar con la cuenta creada.
- A 390 px no hay scroll horizontal. Sin errores en la consola del navegador.
- Screenshots en `docs/visual-qa/8.1/`.
