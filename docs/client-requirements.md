# Client Requirements Log

## Estado actual (Mision 6.1)

- Pedidos e inventario quedan conectados:
  - crear o editar un pedido en `new` no toca el stock;
  - **confirmar** exige elegir el depósito de despacho y reserva el stock (un pedido = un depósito);
  - **entregar** descuenta el stock del depósito y registra la venta;
  - **cancelar** (desde confirmado, en preparación o listo) libera la reserva.
- Si no hay stock suficiente, la confirmación se bloquea con un mensaje que indica el producto, lo pedido, lo disponible y lo que falta. No se reserva nada parcialmente y nunca hay stock negativo.
- Editar los ítems de un pedido confirmado ajusta su reserva. Si no alcanza el stock, la edición se rechaza.
- Disponible = cantidad − reservado. Un ajuste manual no puede dejar la cantidad por debajo de lo reservado.
- Todo cambio de stock (compras, ajustes y ventas) queda en un historial de movimientos que no se puede modificar ni borrar. Cada movimiento tiene el saldo resultante, el usuario y su origen (factura, número de pedido o motivo). Las correcciones se hacen con un ajuste nuevo.
- Se pueden vender materias primas marcadas como vendibles (por ejemplo Papa, Cebolla). El corte no cambia el producto: el stock se descuenta del producto base.
- Una "venta" es un pedido entregado. El módulo Ventas es de solo lectura (listado y total del período); no hay ventas manuales, pagos ni facturación.
- El Dashboard muestra la facturación del mes (suma de pedidos entregados). Mermas y alertas siguen sin datos.
- Los pedidos entregados antes de esta misión no descontaron stock y no se recalcularon. Un pedido confirmado antes de esta misión debe elegir depósito para seguir avanzando.
- Fuera de alcance: producción (materia prima → elaborado), mermas, lotes/vencimientos, mínimos y alertas, transferencias entre depósitos, pedidos multi-depósito, pagos/facturación, ecommerce público.

## Estado actual (Mision 5.2)

- Se incorpora el motor administrativo de pedidos como dominio central para administracion y futuro ecommerce.
- El ecommerce publico futuro no debe implementar logica propia de pedidos: debe consumir `POST /api/orders` y el mismo backend.
- Se incorpora gestion minima de clientes:
  - alta;
  - edicion;
  - activacion/inactivacion;
  - listado y detalle;
  - sin CRM avanzado.
- Se incorpora pedido manual administrativo con:
  - cliente;
  - productos vendibles activos;
  - cortes activos asociados al producto;
  - cantidades;
  - subtotal y total calculados;
  - numero operativo legible.
- Los precios y cortes del pedido quedan congelados en `order_items`.
- Crear un pedido no descuenta, reserva ni altera inventario en esta mision (reemplazado en 6.1: confirmar reserva y entregar descuenta).
- Un producto puede venderse desde administracion aunque no sea visible en catalogo ecommerce.
- Estados disponibles: `new`, `confirmed`, `preparing`, `ready`, `delivered`, `cancelled`.

## Estado actual (Mision 5.1)

- Se prepara la capa comercial futura sin implementar ecommerce publico, carrito ni pedidos.
- Los productos incorporan configuracion comercial minima:
  - vendible;
  - visible en catalogo;
  - precio de venta independiente del costo.
- Se incorporan tipos de corte/preparacion reutilizables por organizacion.
- Los productos pueden definir cortes permitidos y una opcion default.
- Los tipos de corte son opciones de preparacion asociadas a un producto base, no productos independientes.
- El inventario continua perteneciendo al producto base.

## Estado actual (Mision 4.1)

- Se incorpora gestion operativa de proveedores:
  - alta;
  - edicion;
  - activacion;
  - inactivacion;
  - sin borrado fisico.
- Se incorpora registro de compras de materias primas con multiples items.
- Cada compra actualiza inventario del deposito seleccionado y recalcula costo promedio ponderado de las materias primas.
- Los movimientos de inventario generados por compras quedan trazados con `source_type = 'purchase'` y `purchase_order_id`.
- Validacion funcional con PostgreSQL real pendiente por indisponibilidad de Docker Desktop/PostgreSQL local durante la ejecucion.

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
