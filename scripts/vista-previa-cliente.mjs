// npm run vista-previa: tienda de vista previa con el catalogo real de Soluciones Gastronomicas
// (mision 8.9), para mostrarle al cliente como quedaria su tienda.
//
// - Usa el material de material-cliente/ (ignorado por git): logo, fotos e identificacion-fotos.
// - Los PRECIOS SON DE EJEMPLO y la descripcion de cada producto lo dice.
// - Corrige el tono azulado de las fotos de fondo blanco antes de subirlas.
// - Requiere la API local corriendo (npm run dev). Repetible: no duplica productos ni fotos.
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BACKEND, ROOT, bold, cyan, fail, ok, step, warn } from './lib.mjs'

const API = process.env.API_URL ?? 'http://127.0.0.1:3000'
const WEB = process.env.WEB_URL ?? 'http://localhost:5173'
const MATERIAL = join(ROOT, 'material-cliente')
const ACCOUNT = {
  fullName: 'Vista previa',
  email: process.env.PREVIEW_EMAIL ?? 'vista-previa@gastronexo.test',
  password: process.env.PREVIEW_PASSWORD ?? 'vista-previa-gastronexo',
  organizationName: 'Soluciones Gastronómicas',
  organizationSlug: 'soluciones-gastronomicas',
}
const SAMPLE_PRICE_NOTE = 'Precio de ejemplo, a confirmar.'

// [nombre, categoria, foto, precio de ejemplo (Gs.)]. Solo lo identificado con seguridad o
// confirmado por el cliente; las fotos dudosas (coliflor, lechuga/repollo, cebolla en juliana)
// quedan afuera hasta confirmarlas.
const CATALOG = [
  ['Zanahoria en rodajas', 'Rodajas', 7099, 9000],
  ['Zucchini en rodajas', 'Rodajas', 7163, 11000],
  ['Berenjena en rodajas', 'Rodajas', 7183, 11000],
  ['Zanahoria en cubos', 'Cubos', 7102, 9000],
  ['Calabaza en cubos', 'Cubos', 7116, 10000],
  ['Morrón amarillo en cubos', 'Cubos', 7113, 15000],
  ['Zucchini en cubos', 'Cubos', 7167, 11000],
  ['Morrón rojo en tiras', 'Tiras y juliana', 7149, 15000],
  ['Morrón amarillo en tiras', 'Tiras y juliana', 7184, 15000],
  ['Cebolla morada en juliana', 'Tiras y juliana', 7140, 10000],
  ['Repollo morado en juliana', 'Tiras y juliana', 7153, 9000],
  ['Cebolla blanca picada', 'Picados y rallados', 7147, 9000],
  ['Morrón verde picado', 'Picados y rallados', 7176, 13000],
  ['Ajo pelado y picado', 'Picados y rallados', 7216, 12000],
  ['Zanahoria rallada', 'Picados y rallados', 7289, 9000],
  ['Mix de morrones picados', 'Mixes', 7196, 16000],
  ['Mix de morrones en tiras', 'Mixes', 7343, 16000],
  ['Mix de calabaza, zanahoria y morrón', 'Mixes', 7324, 12000],
]
const COVER_PHOTO = 7227
// Recorte de la portada (fracciones de la foto): saca el borde del estudio y deja 16:10.
const COVER_CROP = { left: 0.111, top: 0.203, width: 0.767, height: 0.719 }

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) fail(`Solo contra una API local (API_URL=${API}).`)
if (!existsSync(MATERIAL)) fail('No está la carpeta material-cliente/ con las fotos y el logo del cliente.')

const sharp = createRequire(join(BACKEND, 'package.json'))('sharp')

function findPhotos(dir, found = new Map()) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) findPhotos(full, found)
    else {
      const match = /^IMG_(\d+)\.jpe?g$/i.exec(entry)
      if (match) found.set(Number(match[1]), full)
    }
  }
  return found
}
const photos = findPhotos(join(MATERIAL, 'productos'))

/** Foto lista para subir: con fondo blanco corregido a neutro (las de estudio salian azuladas). */
async function preparePhoto(number, crop) {
  const file = photos.get(number)
  if (!file) fail(`No encuentro la foto IMG_${number}.jpg en material-cliente/productos.`)
  const upright = await sharp(file).rotate().toBuffer({ resolveWithObject: true })
  const { width, height } = upright.info
  let pipeline = sharp(upright.data)
  if (/fondo blanco/i.test(file)) {
    const { data } = await sharp(upright.data)
      .extract({ left: Math.round(width * 0.2), top: Math.round(height * 0.03), width: Math.round(width * 0.6), height: Math.round(height * 0.12) })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const sums = [0, 0, 0]
    for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c++) sums[c] += data[i + c]
    const means = sums.map((sum) => sum / (data.length / 3))
    pipeline = pipeline.linear(means.map((mean) => 240 / mean), [0, 0, 0]).modulate({ saturation: 1.08 })
  }
  if (crop) {
    const corrected = await pipeline.toBuffer()
    pipeline = sharp(corrected).extract({
      left: Math.round(width * crop.left),
      top: Math.round(height * crop.top),
      width: Math.round(width * crop.width),
      height: Math.round(height * crop.height),
    })
  }
  return pipeline.resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
}

async function call(method, path, body, token, contentType) {
  let response
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': contentType ?? 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : contentType ? body : JSON.stringify(body),
    })
  } catch {
    fail(`La API no responde en ${API}.`, 'Levantala con: npm run dev')
  }
  const data = await response.json().catch(() => null)
  if (!response.ok && response.status !== 401) fail(`${method} ${path} → ${response.status}: ${data?.message ?? ''}`)
  return { status: response.status, data }
}

step('Cuenta de vista previa')
let session = await call('POST', '/api/auth/login', { email: ACCOUNT.email, password: ACCOUNT.password })
if (session.status === 200) ok(`Ya existe: ${ACCOUNT.email}`)
else {
  session = await call('POST', '/api/auth/register', ACCOUNT)
  ok(`Creada: ${ACCOUNT.email}`)
}
const token = session.data.token

step('Categorías y depósito')
const existingCategories = (await call('GET', '/api/product-categories?status=all', undefined, token)).data.categories
const categoryIds = {}
for (const name of new Set(CATALOG.map(([, category]) => category))) {
  categoryIds[name] =
    existingCategories.find((category) => category.name === name)?.id ??
    (await call('POST', '/api/product-categories', { name }, token)).data.category.id
}
const warehouses = (await call('GET', '/api/warehouses?status=active', undefined, token)).data.warehouses
const warehouseId =
  warehouses[0]?.id ?? (await call('POST', '/api/warehouses', { name: 'Depósito central' }, token)).data.warehouse.id
ok(`${Object.keys(categoryIds).length} categorías`)

step('Productos con foto')
const existing = (await call('GET', '/api/products?status=all&page=1&pageSize=50', undefined, token)).data.products
for (const [name, category, photo, price] of CATALOG) {
  let product = existing.find((candidate) => candidate.name === name)
  if (!product) {
    product = (
      await call(
        'POST',
        '/api/products',
        {
          name,
          unit: 'unit',
          productType: 'finished_product',
          cost: 0,
          categoryId: categoryIds[category],
          isSellable: true,
          isCatalogVisible: true,
          salePrice: price,
          description: `Lavado, cortado y envasado al vacío. ${SAMPLE_PRICE_NOTE}`,
        },
        token,
      )
    ).data.product
    await call('POST', '/api/inventory/adjustments', { warehouseId, productId: product.id, newQuantity: 30, reason: 'Stock de vista previa' }, token)
  }
  if (!product.imageUrl) {
    await call('POST', `/api/products/${product.id}/image`, await preparePhoto(photo), token, 'image/jpeg')
    ok(`${name} (IMG_${photo})`)
  } else ok(`${name}: ya tenía foto`)
}

step('Marca y datos de la tienda')
const { data: current } = await call('GET', '/api/storefront/settings', undefined, token)
if (!current.settings.logoUrl) {
  const logo = readdirSync(join(MATERIAL, 'marca')).find((file) => /blanco/i.test(file))
  if (logo) {
    await call('POST', '/api/storefront/logo', readFileSync(join(MATERIAL, 'marca', logo)), token, 'image/png')
    ok(`Logo: ${logo}`)
  } else warn('No hay logo blanco en material-cliente/marca.')
}
if (!current.settings.coverUrl) {
  await call('POST', '/api/storefront/cover', await preparePhoto(COVER_PHOTO, COVER_CROP), token, 'image/jpeg')
  ok(`Portada: IMG_${COVER_PHOTO}, recortada`)
}
if (!current.zones.some((zone) => zone.name === 'Zona de ejemplo')) {
  await call('POST', '/api/storefront/zones', { name: 'Zona de ejemplo', fee: 15000, sortOrder: 0 }, token)
}
await call(
  'PUT',
  '/api/storefront/settings',
  {
    isEnabled: true,
    displayName: 'Soluciones Gastronómicas',
    tagline: 'Verduras lavadas, cortadas y envasadas al vacío, listas para tu cocina.',
    contactPhone: null,
    whatsappPhone: null,
    contactEmail: null,
    pickupAddress: null,
    openingHours: null,
    cutoffNotice: 'Vista previa: precios, zonas y horarios son de ejemplo.',
    minOrderAmount: 0,
    allowsPickup: true,
    allowsDelivery: true,
    paymentMethods: ['cash', 'transfer'],
    transferDetails: null,
  },
  token,
)
ok('Tienda publicada')

console.log(`
${bold('Listo.')}
  Tienda:  ${cyan(`${WEB}/tienda/${ACCOUNT.organizationSlug}`)}
  Consola: ${cyan(WEB)}  →  ${ACCOUNT.email} / ${ACCOUNT.password}
  ${SAMPLE_PRICE_NOTE}`)
