// Mision 8.8: marca de la tienda (logo, portada y color de la cabecera).
//
// POST/DELETE /api/storefront/logo y /api/storefront/cover: la imagen viaja como cuerpo crudo
// (Content-Type: image/*), igual que la foto de un producto (8.7).
// PUT /api/storefront/brand-color: { brandColor: "#rrggbb" | null }.

import rateLimit from '@fastify/rate-limit'
import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { config } from '../../config.js'
import { pool } from '../../db/pool.js'
import { withTransaction } from '../../db/transaction.js'
import { ImageRejected, processCoverImage, processLogoImage, removeImageIfUnused } from '../../media/product-images.js'
import { mediaKey, mediaStorage } from '../../media/storage.js'
import { getClientIp } from '../../security/client-ip.js'
import { requireOrganizationRole } from '../../security/authorization.js'
import { getStoreByOrganizationId } from './storefront.service.js'

const manageRoles = requireOrganizationRole('owner', 'admin')

// Texto claro de la cabecera de la tienda (--sf-board-ink en storefront.css).
const HEADER_INK = '#eef3e6'
const MIN_CONTRAST = 4.5

function relativeLuminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

const brandColorSchema = z.object({
  brandColor: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^#[0-9a-f]{6}$/, 'El color tiene que tener el formato #rrggbb.')
    .refine((value) => contrastRatio(value, HEADER_INK) >= MIN_CONTRAST, {
      message: 'Ese color es muy claro: el texto blanco de la cabecera no se leería. Elegí uno más oscuro.',
    })
    .nullable(),
})

const imageSlots = {
  logo: { column: 'logo_url', process: processLogoImage },
  cover: { column: 'cover_url', process: processCoverImage },
} as const

type Slot = keyof typeof imageSlots

async function setBrandImage(organizationId: string, slot: Slot, url: string | null) {
  const { column } = imageSlots[slot]
  return withTransaction(async (client) => {
    // La fila puede no existir todavia (tienda nunca configurada).
    await client.query('INSERT INTO storefront_settings (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING', [organizationId])
    const current = await client.query<{ url: string | null }>(
      `SELECT ${column} AS url FROM storefront_settings WHERE organization_id = $1 FOR UPDATE`,
      [organizationId],
    )
    await client.query(`UPDATE storefront_settings SET ${column} = $2, updated_at = NOW() WHERE organization_id = $1`, [organizationId, url])
    return current.rows[0]?.url ?? null
  })
}

export const storefrontBrandingRoutes: FastifyPluginAsync = async (app) => {
  const maxBytes = Math.round(config.MEDIA_MAX_UPLOAD_MB * 1024 * 1024)

  await app.register(rateLimit, { global: false, keyGenerator: getClientIp })

  app.addContentTypeParser(/^image\/[a-z0-9.+-]+$/i, { parseAs: 'buffer', bodyLimit: maxBytes }, (_request, body, done) => {
    done(null, body)
  })

  for (const slot of Object.keys(imageSlots) as Slot[]) {
    app.post(
      `/${slot}`,
      { preHandler: manageRoles, bodyLimit: maxBytes, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const organizationId = request.organizationAccess!.organization.id
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
          return reply.code(415).send({ message: 'Enviá la imagen como JPG, PNG o WebP.' })
        }

        let processed: Buffer
        try {
          processed = await imageSlots[slot].process(request.body)
        } catch (error) {
          if (error instanceof ImageRejected) return reply.code(415).send({ message: error.message })
          throw error
        }

        const key = mediaKey('brand', organizationId, randomUUID())
        const url = await mediaStorage.put(key, processed, 'image/webp')
        let previous: string | null
        try {
          previous = await setBrandImage(organizationId, slot, url)
        } catch (error) {
          await mediaStorage.remove(key).catch((removeError) => request.log.warn({ err: removeError }, 'No se pudo borrar una imagen sin usar.'))
          throw error
        }
        await removeImageIfUnused(previous, organizationId).catch((error) =>
          request.log.warn({ err: error }, 'No se pudo borrar la imagen anterior de la tienda.'),
        )
        return reply.code(201).send({ settings: await getStoreByOrganizationId(pool, organizationId) })
      },
    )

    app.delete(`/${slot}`, { preHandler: manageRoles }, async (request) => {
      const organizationId = request.organizationAccess!.organization.id
      const previous = await setBrandImage(organizationId, slot, null)
      await removeImageIfUnused(previous, organizationId).catch((error) =>
        request.log.warn({ err: error }, 'No se pudo borrar la imagen de la tienda.'),
      )
      return { settings: await getStoreByOrganizationId(pool, organizationId) }
    })
  }

  app.put('/brand-color', { preHandler: manageRoles }, async (request) => {
    const { brandColor } = brandColorSchema.parse(request.body)
    const organizationId = request.organizationAccess!.organization.id
    await pool.query(
      `INSERT INTO storefront_settings (organization_id, brand_color) VALUES ($1, $2)
       ON CONFLICT (organization_id) DO UPDATE SET brand_color = EXCLUDED.brand_color, updated_at = NOW()`,
      [organizationId, brandColor],
    )
    return { settings: await getStoreByOrganizationId(pool, organizationId) }
  })
}
