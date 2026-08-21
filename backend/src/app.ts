import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { config } from './config.js'
import { pool } from './db/pool.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { inventoryRoutes } from './modules/inventory/inventory.routes.js'
import { warehousesRoutes } from './modules/inventory/warehouses.routes.js'
import { organizationMembersRoutes } from './modules/organization/organization-members.routes.js'
import { productCategoriesRoutes } from './modules/products/product-categories.routes.js'
import { productsRoutes } from './modules/products/products.routes.js'

export function buildApp() {
  const app = Fastify({ logger: true })

  app.register(cors, {
    origin: config.FRONTEND_ORIGIN,
    credentials: true,
  })
  app.register(jwt, { secret: config.JWT_SECRET })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: 'Datos de entrada inválidos.',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      })
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

  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT $1::int AS ready', [1])
      return reply.code(200).send({ status: 'ready' })
    } catch {
      return reply.code(503).send({ status: 'not_ready' })
    }
  })

  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(organizationMembersRoutes, { prefix: '/api/organization' })
  app.register(productCategoriesRoutes, { prefix: '/api/product-categories' })
  app.register(productsRoutes, { prefix: '/api/products' })
  app.register(warehousesRoutes, { prefix: '/api/warehouses' })
  app.register(inventoryRoutes, { prefix: '/api/inventory' })

  return app
}
