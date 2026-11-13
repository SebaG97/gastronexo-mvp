// Mision 8.7: sirve las fotos subidas cuando el almacenamiento es local (desarrollo).
// Con MEDIA_STORAGE=s3 no se registra: las fotos salen del Space/CDN.

import type { FastifyPluginAsync } from 'fastify'
import { isValidMediaKey, localMediaStorage } from './storage.js'

export const uploadsRoutes: FastifyPluginAsync = async (app) => {
  const storage = localMediaStorage()
  if (!storage) return

  app.get('/*', async (request, reply) => {
    const key = (request.params as { '*': string })['*']
    if (!isValidMediaKey(key)) return reply.code(404).send({ message: 'Archivo no encontrado.' })
    try {
      const body = await storage.read(key)
      return reply
        .header('Content-Type', 'image/webp')
        // El nombre es unico por foto: si cambia la foto, cambia la URL.
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('Cross-Origin-Resource-Policy', 'cross-origin')
        .send(body)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send({ message: 'Archivo no encontrado.' })
      throw error
    }
  })
}
