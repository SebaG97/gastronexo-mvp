import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { config } from './config.js'
import { getDatabaseErrorCode, isDatabaseUnavailableError } from './db/errors.js'
import { readinessPool } from './db/pool.js'
import { TransactionAbort } from './db/transaction.js'
import { customersRoutes } from './modules/customers/customers.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { inventoryRoutes } from './modules/inventory/inventory.routes.js'
import { warehousesRoutes } from './modules/inventory/warehouses.routes.js'
import { organizationMembersRoutes } from './modules/organization/organization-members.routes.js'
import { ordersRoutes } from './modules/orders/orders.routes.js'
import { productionRunsRoutes } from './modules/production/production-runs.routes.js'
import { recipesRoutes } from './modules/production/recipes.routes.js'
import { purchasesRoutes } from './modules/purchases/purchases.routes.js'
import { salesRoutes } from './modules/sales/sales.routes.js'
import { suppliersRoutes } from './modules/purchases/suppliers.routes.js'
import { cutTypesRoutes } from './modules/products/cut-types.routes.js'
import { productCategoriesRoutes } from './modules/products/product-categories.routes.js'
import { productsRoutes } from './modules/products/products.routes.js'
import { productImagesRoutes } from './modules/products/product-images.routes.js'
import { uploadsRoutes } from './media/uploads.routes.js'
import { notificationsRoutes } from './modules/notifications/notifications.routes.js'
import { wasteRoutes } from './modules/waste/waste.routes.js'
import { publicStorefrontRoutes } from './modules/storefront/public.routes.js'
import { storefrontAdminRoutes } from './modules/storefront/storefront-admin.routes.js'
import { storefrontBrandingRoutes } from './modules/storefront/storefront-branding.routes.js'

const SERVICE_UNAVAILABLE_BODY = {
  message: 'El servicio está ocupado. Intentá de nuevo en unos segundos.',
  code: 'service_unavailable',
}

export function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: config.TRUST_PROXY,
    // Ningun endpoint necesita mas: un pedido de 100 items ocupa unos pocos KB.
    bodyLimit: 256 * 1024,
  })

  // Headers de seguridad para todas las respuestas de la API (mision 7.1). La API solo
  // devuelve JSON: no carga recursos ni se muestra dentro de un frame.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    reply.header('Cross-Origin-Opener-Policy', 'same-origin')
    if (config.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    return payload
  })

  app.register(cors, {
    origin: config.STOREFRONT_ORIGIN ? [config.FRONTEND_ORIGIN, config.STOREFRONT_ORIGIN] : config.FRONTEND_ORIGIN,
    credentials: true,
  })
  app.register(jwt, { secret: config.JWT_SECRET, verify: { algorithms: ['HS256'] } })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof TransactionAbort) {
      return reply.code(error.statusCode).send(error.body)
    }

    // Pool agotado, timeouts de lock/sentencia o deadlock que persistio tras los reintentos.
    if (isDatabaseUnavailableError(error)) {
      app.log.warn({ code: getDatabaseErrorCode(error) }, 'Base de datos no disponible u ocupada; se responde 503.')
      return reply.code(503).header('Retry-After', '1').send(SERVICE_UNAVAILABLE_BODY)
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: 'Datos de entrada inválidos.',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      })
    }

    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 413) {
      return reply.code(413).send({ message: 'La solicitud es demasiado grande.' })
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode === 400
    ) {
      return reply.code(400).send({ message: 'Solicitud inválida.' })
    }

    // Limite de peticiones de la tienda publica (@fastify/rate-limit).
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 429) {
      return reply.code(429).send({
        message: 'Demasiados intentos seguidos. Esperá un momento y volvé a intentar.',
        code: 'rate_limited',
      })
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 401
    ) {
      return reply.code(401).send({ message: 'Sesión inválida o expirada.' })
    }

    app.log.error(error)
    return reply.code(500).send({ message: 'Ocurrió un error inesperado.' })
  })

  // /health no toca la base. /ready usa su propio pool de una conexion y un tope de tiempo:
  // responde aunque el pool de la API este agotado.
  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/ready', async (_request, reply) => {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        readinessPool.query('SELECT $1::int AS ready', [1]),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('ready_timeout')), config.DB_READY_TIMEOUT_MS)
        }),
      ])
      return reply.code(200).send({ status: 'ready' })
    } catch {
      return reply.code(503).send({ status: 'not_ready' })
    } finally {
      clearTimeout(timer)
    }
  })

  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(organizationMembersRoutes, { prefix: '/api/organization' })
  app.register(customersRoutes, { prefix: '/api/customers' })
  app.register(cutTypesRoutes, { prefix: '/api/cut-types' })
  app.register(productCategoriesRoutes, { prefix: '/api/product-categories' })
  app.register(productsRoutes, { prefix: '/api/products' })
  app.register(productImagesRoutes, { prefix: '/api/products' })
  app.register(uploadsRoutes, { prefix: '/api/uploads' })
  app.register(warehousesRoutes, { prefix: '/api/warehouses' })
  app.register(inventoryRoutes, { prefix: '/api/inventory' })
  app.register(suppliersRoutes, { prefix: '/api/suppliers' })
  app.register(purchasesRoutes, { prefix: '/api/purchases' })
  app.register(ordersRoutes, { prefix: '/api/orders' })
  app.register(salesRoutes, { prefix: '/api/sales' })
  app.register(recipesRoutes, { prefix: '/api/recipes' })
  app.register(productionRunsRoutes, { prefix: '/api/production-runs' })
  app.register(storefrontAdminRoutes, { prefix: '/api/storefront' })
  app.register(storefrontBrandingRoutes, { prefix: '/api/storefront' })
  app.register(publicStorefrontRoutes, { prefix: '/api/public' })
  app.register(notificationsRoutes, { prefix: '/api/notifications' })
  app.register(wasteRoutes, { prefix: '/api/waste' })

  return app
}
