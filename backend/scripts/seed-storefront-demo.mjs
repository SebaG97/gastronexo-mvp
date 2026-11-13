// Carga datos de demostracion de la tienda (Mision 7.2) en la organizacion del usuario indicado.
// Uso: SEED_EMAIL=... SEED_PASSWORD=... node scripts/seed-storefront-demo.mjs
// Solo contra la API local. Es repetible: lo que ya existe (por nombre) no se duplica.

const API = process.env.API_URL ?? 'http://127.0.0.1:3000'
const email = process.env.SEED_EMAIL
const password = process.env.SEED_PASSWORD

if (!email || !password) {
  console.error('Definí SEED_EMAIL y SEED_PASSWORD.')
  process.exit(1)
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) {
  console.error(`Se niega a correr contra ${API}: solo API local.`)
  process.exit(1)
}

let token = ''

async function call(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(data)}`)
  }
  return data
}

const categories = ['Verduras', 'Frutas', 'Hojas y hierbas', 'Precortados']
const cutTypes = ['Entero', 'Juliana', 'Cubos', 'Bastón', 'Rodajas']

// [nombre, categoria, unidad, costo, precio, descripcion, cortes [nombre, recargo, default], stock]
const products = [
  ['Tomate perita', 'Verduras', 'kg', 6000, 9500, 'Firme y maduro, ideal para salsas y ensaladas.', [['Entero', 0, true], ['Cubos', 2500]], 60],
  ['Cebolla blanca', 'Verduras', 'kg', 3500, 6000, 'Bolsa seleccionada, calibre mediano.', [['Entero', 0, true], ['Juliana', 2000], ['Cubos', 2000]], 80],
  ['Papa lavada', 'Verduras', 'kg', 3000, 5500, 'Papa blanca lavada, apta para fritura.', [['Entero', 0, true], ['Bastón', 3000], ['Cubos', 2500]], 120],
  ['Zanahoria', 'Verduras', 'kg', 3200, 5800, 'Sin hojas, lavada.', [['Entero', 0, true], ['Rodajas', 2000], ['Juliana', 2500]], 4],
  ['Locote rojo', 'Verduras', 'kg', 12000, 18000, 'Morrón rojo carnoso.', [['Entero', 0, true], ['Juliana', 3000]], 25],
  ['Zapallo cabutia', 'Verduras', 'kg', 4000, 7000, null, [], 0],
  ['Banana', 'Frutas', 'kg', 4500, 7500, 'Banana de Itapúa, punto justo de maduración.', [], 40],
  ['Limón sutil', 'Frutas', 'kg', 5000, 9000, 'Jugoso, para bar y cocina.', [], 30],
  ['Naranja de jugo', 'Frutas', 'kg', 3000, 5000, null, [], 90],
  ['Lechuga crespa', 'Hojas y hierbas', 'unit', 2500, 4500, 'Planta entera, hidropónica.', [], 35],
  ['Cebollita de hoja', 'Hojas y hierbas', 'unit', 1500, 3000, 'Atado.', [], 3],
  ['Perejil', 'Hojas y hierbas', 'unit', 1500, 3000, 'Atado fresco.', [], 20],
  ['Mix de ensalada', 'Precortados', 'portion', 9000, 15000, 'Lechuga, zanahoria rallada y repollo morado. Bandeja de 500 g.', [], 18],
  ['Sofrito base', 'Precortados', 'portion', 11000, 18500, 'Cebolla, locote y ajo picados. Bandeja de 1 kg.', [], 12],
]

const zones = [
  ['Centro y Sajonia', 10000],
  ['Villa Morra y Recoleta', 15000],
  ['San Lorenzo y Fernando de la Mora', 25000],
]

const login = await call('POST', '/api/auth/login', { email, password })
token = login.token
console.log(`Organización: ${login.organization.name} (${login.organization.slug})`)

const existingCategories = (await call('GET', '/api/product-categories?status=all')).categories
const categoryIds = {}
for (const name of categories) {
  const found = existingCategories.find((category) => category.name === name)
  categoryIds[name] = found?.id ?? (await call('POST', '/api/product-categories', { name })).category.id
}

const existingCuts = (await call('GET', '/api/cut-types?status=all')).cutTypes
const cutIds = {}
for (const name of cutTypes) {
  const found = existingCuts.find((cut) => cut.name === name)
  cutIds[name] = found?.id ?? (await call('POST', '/api/cut-types', { name })).cutType.id
}

const warehouses = (await call('GET', '/api/warehouses?status=active')).warehouses
const warehouseId =
  warehouses.find((warehouse) => warehouse.name === 'Depósito central')?.id ??
  (await call('POST', '/api/warehouses', { name: 'Depósito central' })).warehouse.id

const existingProducts = (await call('GET', '/api/products?status=all&page=1&pageSize=100')).products
for (const [name, category, unit, cost, salePrice, description, cuts, stock] of products) {
  if (existingProducts.some((product) => product.name === name)) {
    continue
  }
  const { product } = await call('POST', '/api/products', {
    name,
    unit,
    productType: 'raw_material',
    cost,
    categoryId: categoryIds[category],
    isSellable: true,
    isCatalogVisible: true,
    salePrice,
    description,
  })
  for (const [index, [cutName, modifier, isDefault]] of cuts.entries()) {
    await call('POST', `/api/products/${product.id}/cut-options`, {
      cutTypeId: cutIds[cutName],
      priceModifier: modifier,
      isDefault: Boolean(isDefault),
      sortOrder: index,
    })
  }
  if (stock > 0) {
    await call('POST', '/api/inventory/adjustments', {
      warehouseId,
      productId: product.id,
      newQuantity: stock,
      reason: 'Stock inicial demo tienda',
    })
  }
  console.log(`  + ${name}`)
}

const { zones: currentZones } = await call('GET', '/api/storefront/settings')
for (const [index, [name, fee]] of zones.entries()) {
  if (!currentZones.some((zone) => zone.name === name)) {
    await call('POST', '/api/storefront/zones', { name, fee, sortOrder: index })
  }
}

await call('PUT', '/api/storefront/settings', {
  isEnabled: true,
  displayName: 'Gastronexo Mercado',
  tagline: 'Verdura y fruta del día para tu cocina, cortada como la necesitás.',
  contactPhone: '021 600 123',
  whatsappPhone: '595981000123',
  contactEmail: 'pedidos@gastronexo.com',
  pickupAddress: 'Av. Mcal. López 1234, Asunción',
  openingHours: 'Lunes a sábado de 6:00 a 14:00',
  cutoffNotice: 'Los pedidos que entran después de las 15:00 se entregan al día siguiente.',
  minOrderAmount: 50000,
  allowsPickup: true,
  allowsDelivery: true,
  paymentMethods: ['cash', 'transfer', 'card_on_delivery'],
  transferDetails: 'Banco Ejemplo, cuenta 000-123456, RUC 80000000-1',
})

console.log(`Tienda lista en /tienda/${login.organization.slug}`)
