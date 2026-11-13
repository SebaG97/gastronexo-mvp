// npm run demo: cuenta de demostracion con tienda, productos, stock y un pedido de ejemplo
// (mision 8.2). Requiere la API corriendo (npm run dev). Repetible: no duplica nada.
import { join } from 'node:path'
import { BACKEND, bold, cyan, fail, ok, run, step, warn } from './lib.mjs'

const API = process.env.API_URL ?? 'http://127.0.0.1:3000'
const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const DEMO = {
  fullName: 'Cuenta Demo',
  email: process.env.DEMO_EMAIL ?? 'demo@gastronexo.test',
  password: process.env.DEMO_PASSWORD ?? 'demo-gastronexo-123',
  organizationName: 'Mercado Demo',
  organizationSlug: 'mercado-demo',
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) fail(`Solo contra una API local (API_URL=${API}).`)

async function call(method, path, body, token, headers = {}) {
  let response
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    fail(`La API no responde en ${API}.`, 'Levantala con: npm run dev')
  }
  return { status: response.status, data: await response.json().catch(() => null) }
}

step('Cuenta demo')
let session = await call('POST', '/api/auth/login', { email: DEMO.email, password: DEMO.password })
if (session.status === 200) ok(`Ya existe: ${DEMO.email}`)
else if (session.status === 401) {
  session = await call('POST', '/api/auth/register', DEMO)
  if (session.status === 409) fail('El email o el link "mercado-demo" ya están usados con otra contraseña.', 'Usá DEMO_EMAIL / DEMO_PASSWORD para otra cuenta.')
  if (session.status !== 201) fail(`No se pudo crear la cuenta demo (${session.status}): ${session.data?.message ?? ''}`)
  ok(`Creada: ${DEMO.email}`)
} else fail(`Login demo respondió ${session.status}: ${session.data?.message ?? ''}`)

step('Catálogo, stock y tienda')
const seedStatus = run('node', [join(BACKEND, 'scripts', 'seed-storefront-demo.mjs')], {
  cwd: BACKEND,
  env: { ...process.env, API_URL: API, SEED_EMAIL: DEMO.email, SEED_PASSWORD: DEMO.password },
  shell: false,
})
if (seedStatus !== 0) fail('La carga de datos de ejemplo falló.')

step('Pedido de ejemplo')
const token = session.data.token
const existing = await call('GET', '/api/orders?page=1&pageSize=1', null, token)
const slug = session.data.organization.slug
if (existing.data?.pagination?.total > 0) ok('Ya hay pedidos: no se crea otro')
else {
  const products = (await call('GET', `/api/public/${slug}/products?pageSize=60`)).data?.products ?? []
  const picks = products.filter((product) => product.availability !== 'out_of_stock').slice(0, 3)
  if (picks.length === 0) warn('No hay productos disponibles para armar el pedido de ejemplo.')
  else {
    // Como la tienda: los productos con cortes van con su corte por defecto.
    const items = picks.map((product) => ({
      productId: product.id,
      cutTypeId: product.cuts?.find((cut) => cut.isDefault)?.id ?? null,
      quantity: product.unit === 'kg' ? 3 : 2,
    }))
    const quoteFor = async () => (await call('POST', `/api/public/${slug}/cart/quote`, { items, fulfillmentType: 'pickup' })).data?.quote
    let quote = await quoteFor()
    // Llegar al pedido minimo de la tienda multiplicando las cantidades (enteras si lo eran).
    if (quote && !quote.meetsMinimum && quote.subtotal > 0) {
      const factor = Math.ceil(quote.minOrderAmount / quote.subtotal)
      for (const item of items) item.quantity *= factor
      quote = await quoteFor()
    }
    const order = await call(
      'POST',
      `/api/public/${slug}/orders`,
      {
        contact: { name: 'María González', phone: '0981 123 456' },
        fulfillment: { type: 'pickup' },
        payment: { method: 'cash', cashChangeFor: Math.ceil((quote?.total ?? 0) / 50000) * 50000 + 50000 },
        notes: 'Pedido de ejemplo creado por npm run demo.',
        items,
        expectedTotal: quote?.total ?? 0,
      },
      null,
      { 'Idempotency-Key': 'demo-pedido-ejemplo-1' },
    )
    if (order.status === 201 || order.status === 200) ok(`Pedido ${order.data.order.orderNumber} de la tienda, esperando confirmación`)
    else warn(`No se pudo crear el pedido de ejemplo (${order.status}): ${order.data?.message ?? ''}`)
  }
}

console.log(`
${bold('Demo lista.')}

  Consola:  ${cyan(WEB)}
            email ${bold(DEMO.email)}  ·  contraseña ${bold(DEMO.password)}
  Tienda:   ${cyan(`${WEB}/tienda/${slug}`)}
`)
