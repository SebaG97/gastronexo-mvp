# Client Requirements Log

## Estado actual (Misión 3.1)

- Se incorpora clasificación explícita de productos:
  - `raw_material` (materias primas sin procesar)
  - `finished_product` (productos elaborados para venta)
- Todos los productos existentes migran por defecto a `raw_material` para evitar clasificarlos implícitamente como vendibles.
- Se habilita stock inicial por depósito con aislamiento por `organization_id`.

## Alcance cubierto por esta misión

- CRUD base de depósitos por organización (`warehouses`).
- Inventario base por producto y depósito (`inventory_balances`) con cantidad actual no negativa.
- Ajustes manuales transitorios (`inventory_adjustments`) con auditoría completa:
  - cantidad anterior,
  - cantidad nueva,
  - diferencia (`delta`),
  - motivo obligatorio,
  - usuario que ajusta,
  - fecha/hora.
- Lectura de inventario y ajustes para `owner|admin|operator|viewer`.
- Escritura restringida a `owner|admin|operator`.
- Bloqueo de inactivación de depósito si tiene inventario positivo.

## Fuera de alcance en Misión 3.1

- Movimientos inmutables generales de inventario.
- Flujos de compras, producción, ventas y reservas conectados al stock.
- Lotes, vencimientos, mínimos/máximos y alertas.
