import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { config } from './config.js'
import { authRoutes } from './modules/auth/auth.routes.js'
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
      error.statusCode === 401
    ) {
      return reply.code(401).send({ message: 'Sesión inválida o expirada.' })
    }

    app.log.error(error)
    return reply.code(500).send({ message: 'Ocurrió un error inesperado.' })
  })

  app.get('/health', async () => ({ status: 'ok' }))
  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(productsRoutes, { prefix: '/api/products' })

  return app
}
