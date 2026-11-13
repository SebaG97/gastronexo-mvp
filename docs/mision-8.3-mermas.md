# Misión 8.3 - Mermas

## Objetivo

Registrar lo que se pierde (vencido, roto, recortes, faltantes) con su impacto económico, sobre el mismo ledger de stock. Reemplaza el módulo vacío de Mermas, el último del núcleo del MVP.

## Reglas

- **Una merma** = un producto, un depósito, una cantidad, un motivo, notas opcionales y una fecha (hoy o anterior, nunca futura). Se numera **`MER-000001`** por organización.
- **Motivos:** vencido o deteriorado, roto o dañado, recorte de preparación, faltante o robo, otro. Con "Otro", las notas son obligatorias.
- **Solo stock disponible.** No se puede dar de baja lo reservado por pedidos confirmados, y el stock nunca queda negativo. Los productos por unidad, caja o porción solo aceptan cantidades enteras.
- **Costo.** Se congela el costo promedio del producto al momento de la merma (`unit_cost` y `total_cost`). La salida **no cambia** el costo promedio, igual que una venta.
- **Anular.** Pide un motivo y devuelve la cantidad al depósito con un movimiento inverso (`waste_void`). Recalcula el promedio como si entrara a ese costo congelado. Una merma no se puede anular dos veces. El registro queda en el historial como "Anulada".
- **Roles.** Owner, admin y operator registran y anulan. Viewer solo consulta.

## Cambios

- **Migración `011_waste.sql`:**
  - `waste_records`, con FKs compuestas por organización, `CHECK` de motivo, de notas con "Otro" y de campos de anulación.
  - `waste_sequences`.
  - Ledger: `movement_type = 'waste'` con orígenes `waste` (delta < 0) y `waste_void` (delta > 0).
- **API `/api/waste`:**
  - `GET /`: filtros por período, motivo, producto, depósito y estado, con paginación, y un **resumen** con costo total, cantidad y desglose por motivo (solo mermas vigentes).
  - `GET /:id`, `POST /` y `POST /:id/void`.
  - Orden de bloqueo canónico de la 6.3: cabecera (al anular) → balances → costos (`FOR NO KEY UPDATE`) → secuencia.
- **Stock:** el historial de movimientos filtra por "Mermas", muestra "Merma" y "Merma anulada" y usa el número `MER-` como referencia.
- **Consola:**
  - **Mermas:** formulario que lista solo productos con stock disponible en el depósito elegido, muestra el costo estimado y queda abierto para cargar la siguiente.
  - Resumen del período: costo total y barras por motivo.
  - Tabla con filtros (este mes, mes pasado, 7 días, todo; motivo; vigentes, anuladas o todas) y anulación con motivo.
  - El botón de la barra "Registrar merma" quedó habilitado.
- **Dashboard:** "Mermas del mes" muestra el costo y la cantidad de registros, en lugar de "Sin datos todavía".
- **`check:consistency`:** los movimientos `waste` y `waste_void` exigen su documento, numeración `MER-` sin duplicados, y cada merma tiene su salida (y su devolución si está anulada).

## Verificación

- **API** (organizaciones nuevas cargadas con el seed):
  - una merma de 1,5 kg da 201 `MER-000001`, con el costo congelado (4.500 × 1,5 = 6.750); el stock baja 1,5, el costo promedio no cambia, y el historial de Stock muestra el movimiento con su referencia;
  - más que lo disponible → 409 `insufficient_stock`;
  - decimales en un producto por unidad → 400;
  - "Otro" sin notas → 400;
  - fecha futura → 400;
  - con 10 kg reservados por un pedido confirmado, mermar 1 kg más que el disponible → 409 (informa lo reservado), y mermar exactamente lo disponible → 201 con la reserva intacta;
  - anular devuelve el stock y deja el costo igual; una segunda anulación → 409;
  - el resumen solo cuenta las vigentes, y los filtros funcionan;
  - **concurrencia:** 10 mermas simultáneas con 5 disponibles → 5 × 201 + 5 × 409, sin 5xx y con números `MER-` únicos; 5 anulaciones simultáneas de la misma merma → 1 × 200 + 4 × 409;
  - otra organización: ver o anular → 404, y crear con un producto ajeno → 404.
- **UI con Playwright** (cuenta demo, 1440 y 390 px):
  - el formulario lista productos con su disponible, frena el exceso y "Otro" sin notas antes de enviar, y muestra el costo estimado;
  - al registrar confirma número y costo, y actualiza el resumen y la tabla;
  - anular pide motivo, la merma sale de "Vigentes" y aparece en "Todas" con su motivo;
  - el historial de Stock filtra mermas, y el Dashboard muestra "Mermas del mes";
  - un **viewer** ve todo, pero sin "Registrar merma" ni "Anular";
  - sin scroll horizontal a 390 px y sin errores de consola.
- **Regresión:** `stress:writes` OK y `check:consistency` OK (incluidos los chequeos nuevos). Builds OK.
- Screenshots en `docs/visual-qa/8.3/`.

**Nota de proceso:** el primer script de prueba cambió un saldo por SQL en su organización de prueba, y `check:consistency` lo detectó (saldo ≠ suma del ledger). Se corrigió con un ajuste compensatorio, como en la 6.3, sin tocar movimientos existentes, y el script ahora usa la API. Backup previo: `~/gastronexo-backups/pre-mision-8.3-*.dump`.

## Pendientes

- Merma de producción real frente a teórica (rendimiento de recetas): queda para una misión de producción.
- Mermas por lote o vencimiento: no hay lotes todavía.
- Exportar el reporte de mermas.
