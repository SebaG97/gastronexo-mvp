// Organizacion de prueba aislada y escenarios de escritura que compiten por los mismos productos.

const PASSWORD = 'StressTest-12345'

function pick(list, index) {
  return list[index % list.length]
}

function shuffle(list) {
  const copy = [...list]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[other]] = [copy[other], copy[index]]
  }
  return copy
}

async function must(responsePromise, label, expected = [200, 201]) {
  const response = await responsePromise
  if (!expected.includes(response.status)) {
    throw new Error(`Setup "${label}" fallo: ${response.status} ${JSON.stringify(response.data)}`)
  }
  return response.data
}

/**
 * Crea una organizacion nueva (nunca toca datos existentes) con un deposito, proveedor, cliente,
 * 4 materias primas vendibles, 2 terminados con receta y stock inicial.
 */
export async function createFixture(api, label = 'stress') {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const registered = await must(
    api('POST', '/api/auth/register', null, {
      fullName: 'Stress Owner',
      email: `${label}.${stamp}@example.test`,
      password: PASSWORD,
      organizationName: `Stress ${label} ${stamp}`,
      organizationSlug: `${label}-${stamp}`.toLowerCase(),
    }),
    'register',
  )
  const token = registered.token
  const organizationId = registered.organization.id

  const warehouse = (await must(api('POST', '/api/warehouses', token, { name: 'Deposito stress' }), 'warehouse')).warehouse
  const supplier = (await must(api('POST', '/api/suppliers', token, { name: 'Proveedor stress' }), 'supplier')).supplier
  const customer = (await must(api('POST', '/api/customers', token, { name: 'Cliente stress' }), 'customer')).customer

  async function product(name, productType, extra = {}) {
    const data = await must(
      api('POST', '/api/products', token, {
        name,
        unit: 'kg',
        productType,
        cost: 0,
        isSellable: true,
        salePrice: 10000,
        ...extra,
      }),
      `product ${name}`,
    )
    return data.product
  }

  const raws = []
  for (const name of ['Harina', 'Azucar', 'Manteca', 'Huevo']) {
    raws.push(await product(`${name} stress`, 'raw_material'))
  }
  const finished = [await product('Masa stress', 'finished_product'), await product('Relleno stress', 'finished_product')]

  await must(
    api('POST', '/api/recipes', token, {
      productId: finished[0].id,
      yieldQuantity: 1,
      items: [
        { ingredientProductId: raws[0].id, quantity: 0.5 },
        { ingredientProductId: raws[1].id, quantity: 0.25 },
      ],
    }),
    'recipe masa',
  )
  await must(
    api('POST', '/api/recipes', token, {
      productId: finished[1].id,
      yieldQuantity: 2,
      items: [
        { ingredientProductId: raws[1].id, quantity: 0.5 },
        { ingredientProductId: raws[2].id, quantity: 0.5 },
        { ingredientProductId: raws[3].id, quantity: 0.1 },
      ],
    }),
    'recipe relleno',
  )

  await must(
    api('POST', '/api/purchases', token, {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      invoiceNumber: `INI-${stamp}`,
      purchaseDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'contado',
      items: raws.map((raw) => ({ productId: raw.id, quantity: 2000, unitCost: 1000 })),
    }),
    'initial purchase',
  )
  for (const item of finished) {
    await must(
      api('POST', '/api/production-runs', token, { productId: item.id, warehouseId: warehouse.id, quantity: 200 }),
      `initial production ${item.name}`,
    )
  }

  return {
    token,
    organizationId,
    warehouse,
    supplier,
    customer,
    raws,
    finished,
    sellables: [...raws, ...finished],
    stamp,
    sequence: 0,
  }
}

/** Producto nuevo sin balance: varios ajustes concurrentes sobre el lo crean a la vez. */
export async function createProductWithoutBalance(api, ctx, name) {
  const data = await must(
    api('POST', '/api/products', ctx.token, { name, unit: 'kg', productType: 'raw_material', cost: 0 }),
    `product ${name}`,
  )
  return data.product
}

function orderItems(ctx, seed) {
  const first = pick(ctx.sellables, seed)
  const second = pick(ctx.sellables, seed + 3)
  const items = [{ productId: first.id, quantity: 1 }]
  if (second.id !== first.id) items.push({ productId: second.id, quantity: 0.5 })
  return items
}

/**
 * Escenarios. Cada uno ejecuta una o mas escrituras en secuencia y corta en la primera
 * respuesta que no sea 2xx. `record` devuelve true si se puede seguir.
 */
export const scenarios = {
  async orderLifecycle(api, ctx, record, seed) {
    const T = ctx.token
    let r = await api('POST', '/api/orders', T, { customerId: ctx.customer.id, items: orderItems(ctx, seed) })
    if (!record('pedido: crear', r)) return
    const orderId = r.data.order.id

    r = await api('PATCH', `/api/orders/${orderId}`, T, { notes: `stress ${seed}`, items: orderItems(ctx, seed + 1) })
    if (!record('pedido: editar (nuevo)', r)) return

    r = await api('PATCH', `/api/orders/${orderId}/status`, T, { status: 'confirmed', warehouseId: ctx.warehouse.id })
    if (!record('pedido: confirmar', r)) return

    r = await api('PATCH', `/api/orders/${orderId}`, T, { items: orderItems(ctx, seed + 2) })
    if (!record('pedido: editar (confirmado)', r)) return

    for (const status of ['preparing', 'ready', 'delivered']) {
      r = await api('PATCH', `/api/orders/${orderId}/status`, T, { status })
      if (!record(status === 'delivered' ? 'pedido: entregar' : `pedido: ${status}`, r)) return
    }
  },

  async orderCancel(api, ctx, record, seed) {
    const T = ctx.token
    let r = await api('POST', '/api/orders', T, { customerId: ctx.customer.id, items: orderItems(ctx, seed) })
    if (!record('pedido: crear', r)) return
    const orderId = r.data.order.id

    r = await api('PATCH', `/api/orders/${orderId}/status`, T, { status: 'confirmed', warehouseId: ctx.warehouse.id })
    if (!record('pedido: confirmar', r)) return

    r = await api('PATCH', `/api/orders/${orderId}/status`, T, { status: 'cancelled' })
    record('pedido: cancelar', r)
  },

  async purchase(api, ctx, record, seed) {
    ctx.sequence += 1
    const r = await api('POST', '/api/purchases', ctx.token, {
      supplierId: ctx.supplier.id,
      warehouseId: ctx.warehouse.id,
      invoiceNumber: `ST-${ctx.stamp}-${seed}-${ctx.sequence}`,
      purchaseDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'contado',
      // Orden aleatorio en el payload: el servidor debe bloquear siempre en el mismo orden.
      items: shuffle(ctx.raws).map((raw, index) => ({ productId: raw.id, quantity: 3 + index, unitCost: 900 + seed })),
    })
    record('compra', r)
  },

  async adjustment(api, ctx, record, seed) {
    const product = pick(ctx.sellables, seed)
    const current = await api('GET', `/api/inventory?warehouseId=${ctx.warehouse.id}&pageSize=100`, ctx.token)
    const balance = current.data?.balances?.find((row) => row.productId === product.id)
    const newQuantity = Number(balance?.quantity ?? 0) + 2
    const r = await api('POST', '/api/inventory/adjustments', ctx.token, {
      warehouseId: ctx.warehouse.id,
      productId: product.id,
      newQuantity,
      reason: `stress ${seed}`,
    })
    record('ajuste de inventario', r)
  },

  async adjustmentNewBalance(api, ctx, record, seed) {
    if (!ctx.productWithoutBalance) return
    const r = await api('POST', '/api/inventory/adjustments', ctx.token, {
      warehouseId: ctx.warehouse.id,
      productId: ctx.productWithoutBalance.id,
      newQuantity: 5 + (seed % 7),
      reason: `stress balance nuevo ${seed}`,
    })
    record('ajuste (balance nuevo)', r)
  },

  async production(api, ctx, record, seed) {
    const r = await api('POST', '/api/production-runs', ctx.token, {
      productId: pick(ctx.finished, seed).id,
      warehouseId: ctx.warehouse.id,
      quantity: 2,
    })
    record('produccion', r)
  },

  async productionVoid(api, ctx, record, seed) {
    let r = await api('POST', '/api/production-runs', ctx.token, {
      productId: pick(ctx.finished, seed + 1).id,
      warehouseId: ctx.warehouse.id,
      quantity: 1,
    })
    if (!record('produccion', r)) return
    r = await api('POST', `/api/production-runs/${r.data.productionRun.id}/void`, ctx.token, { reason: 'stress' })
    record('produccion: anular', r)
  },

  async customer(api, ctx, record, seed) {
    ctx.sequence += 1
    const r = await api('POST', '/api/customers', ctx.token, { name: `Cliente stress ${seed}-${ctx.sequence}` })
    record('cliente: alta', r)
  },
}

// Ciclo de 12: con N=10 ya hay dos compras, dos producciones y dos ajustes sobre un balance
// nuevo en simultaneo, mezclados con pedidos que reservan y descuentan los mismos productos.
export const scenarioCycle = [
  'orderLifecycle',
  'purchase',
  'production',
  'adjustmentNewBalance',
  'orderCancel',
  'adjustment',
  'productionVoid',
  'adjustmentNewBalance',
  'customer',
  'purchase',
  'orderLifecycle',
  'production',
]
