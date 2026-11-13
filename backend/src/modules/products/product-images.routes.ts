// Mision 8.7: subir y quitar la foto de un producto.
//
// POST /api/products/:id/image con el archivo como cuerpo (Content-Type: image/*), sin multipart.
// En un plugin aparte para que el parser de imagenes y su limite de tamaño solo apliquen aca.

import rateLimit from '@fastify/rate-limit'
import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { config } from '../../config.js'
import { abortTransaction, withTransaction } from '../../db/transaction.js'
import { ImageRejected, processProductImage, removeImageIfUnused } from '../../media/product-images.js'
import { mediaStorage, productImageKey } from '../../media/storage.js'
import { getClientIp } from '../../security/client-ip.js'
import { requireOrganizationRole } from '../../security/authorization.js'

const paramsSchema = z.object({ id: z.string().uuid() })
const writeRoles = requireOrganizationRole('owner', 'admin', 'operator')

export const productImagesRoutes: FastifyPluginAsync = async (app) => {
  const maxBytes = Math.round(config.MEDIA_MAX_UPLOAD_MB * 1024 * 1024)

  await app.register(rateLimit, { global: false, keyGenerator: getClientIp })

  app.addContentTypeParser(/^image\/[a-z0-9.+-]+$/i, { parseAs: 'buffer', bodyLimit: maxBytes }, (_request, body, done) => {
    done(null, body)
  })

  app.post(
    '/:id/image',
    {
      preHandler: writeRoles,
      bodyLimit: maxBytes,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = paramsSchema.parse(request.params)
      const organizationId = request.organizationAccess!.organization.id

      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        return reply.code(415).send({ message: 'Enviá la foto como imagen (JPG, PNG o WebP).' })
      }

      let processed: Buffer
      try {
        processed = await processProductImage(request.body)
      } catch (error) {
        if (error instanceof ImageRejected) return reply.code(415).send({ message: error.message })
        throw error
      }

      const key = productImageKey(organizationId, randomUUID())
      const imageUrl = await mediaStorage.put(key, processed, 'image/webp')

      let previousUrl: string | null = null
      try {
        await withTransaction(async (client) => {
          const current = await client.query<{ imageUrl: string | null }>(
            `SELECT image_url AS "imageUrl"
             FROM products
             WHERE organization_id = $1 AND id = $2
             FOR NO KEY UPDATE`,
            [organizationId, id],
          )
          if (!current.rows[0]) abortTransaction(404, { message: 'Producto no encontrado.' })
          previousUrl = current.rows[0].imageUrl
          await client.query(
            `UPDATE products SET image_url = $3, updated_at = NOW()
             WHERE organization_id = $1 AND id = $2`,
            [organizationId, id, imageUrl],
          )
        })
      } catch (error) {
        // El producto no se actualizo: la foto nueva no la usa nadie.
        await mediaStorage.remove(key).catch((removeError) => request.log.warn({ err: removeError }, 'No se pudo borrar una foto sin usar.'))
        throw error
      }

      await removeImageIfUnused(previousUrl, organizationId).catch((error) =>
        request.log.warn({ err: error }, 'No se pudo borrar la foto anterior del producto.'),
      )

      return reply.code(201).send({ product: { id, imageUrl }, size: processed.length })
    },
  )

  app.delete('/:id/image', { preHandler: writeRoles }, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params)
    const organizationId = request.organizationAccess!.organization.id

    const previousUrl = await withTransaction(async (client) => {
      const current = await client.query<{ imageUrl: string | null }>(
        `SELECT image_url AS "imageUrl"
         FROM products
         WHERE organization_id = $1 AND id = $2
         FOR NO KEY UPDATE`,
        [organizationId, id],
      )
      if (!current.rows[0]) abortTransaction(404, { message: 'Producto no encontrado.' })
      await client.query(
        `UPDATE products SET image_url = NULL, updated_at = NOW()
         WHERE organization_id = $1 AND id = $2`,
        [organizationId, id],
      )
      return current.rows[0].imageUrl
    })

    await removeImageIfUnused(previousUrl, organizationId).catch((error) =>
      request.log.warn({ err: error }, 'No se pudo borrar la foto del producto.'),
    )

    return reply.send({ product: { id, imageUrl: null } })
  })
}
