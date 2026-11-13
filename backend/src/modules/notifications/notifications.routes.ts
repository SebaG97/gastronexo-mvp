import type { FastifyPluginAsync } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'
import { getClientIp } from '../../security/client-ip.js'
import { ChannelError, getTelegramBotUsername, isEmailAvailable, isTelegramAvailable } from './channels.js'
import {
  createTelegramLinkCode,
  getNotificationSettings,
  processTelegramUpdates,
  sendTestNotification,
} from './notifications.service.js'

const updateEmailsSchema = z.object({
  emails: z
    .array(z.string().trim().toLowerCase().email().max(160))
    .max(5, 'Hasta 5 emails.')
    .transform((emails) => [...new Set(emails)]),
})

const UNAVAILABLE_MESSAGE = 'Telegram no está configurado en el servidor (falta TELEGRAM_BOT_TOKEN).'

async function notificationsResponse(organizationId: string) {
  const settings = await getNotificationSettings(pool, organizationId)
  let botUsername: string | null = null
  let botError: string | null = null
  if (isTelegramAvailable()) {
    try {
      botUsername = await getTelegramBotUsername()
    } catch (error) {
      botError = error instanceof ChannelError ? 'No se pudo conectar con el bot de Telegram. Revisá TELEGRAM_BOT_TOKEN.' : 'Error al consultar el bot.'
    }
  }

  const recent = await pool.query(
    `SELECT n.channel, n.status, n.attempts, n.last_error AS "lastError", n.sent_at AS "sentAt",
            n.created_at AS "createdAt", o.order_number AS "orderNumber"
     FROM order_notifications n
     JOIN orders o ON o.id = n.order_id AND o.organization_id = n.organization_id
     WHERE n.organization_id = $1
     ORDER BY n.created_at DESC
     LIMIT 10`,
    [organizationId],
  )

  const linkPending =
    settings.telegramLinkCode && settings.telegramLinkExpiresAt && new Date(settings.telegramLinkExpiresAt) > new Date()

  return {
    telegram: {
      available: isTelegramAvailable() && !botError,
      unavailableReason: !isTelegramAvailable() ? UNAVAILABLE_MESSAGE : botError,
      botUsername,
      linked: Boolean(settings.telegramChatId),
      chatTitle: settings.telegramChatTitle,
      linkedAt: settings.telegramLinkedAt,
      pendingLink:
        linkPending && botUsername
          ? {
              code: settings.telegramLinkCode,
              expiresAt: settings.telegramLinkExpiresAt,
              url: `https://t.me/${botUsername}?start=${settings.telegramLinkCode}`,
            }
          : null,
    },
    email: {
      available: isEmailAvailable(),
      unavailableReason: isEmailAvailable() ? null : 'El email no está configurado en el servidor (faltan RESEND_API_KEY y EMAIL_FROM).',
      recipients: settings.notifyEmails,
    },
    recent: recent.rows,
  }
}

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, { global: false, keyGenerator: getClientIp })
  const readRoles = requireOrganizationRole('owner', 'admin', 'operator', 'viewer')
  const writeRoles = requireOrganizationRole('owner', 'admin')

  app.get('/', { preHandler: readRoles }, async (request) =>
    notificationsResponse(request.organizationAccess!.organization.id),
  )

  app.put('/emails', { preHandler: writeRoles }, async (request) => {
    const input = updateEmailsSchema.parse(request.body)
    const organizationId = request.organizationAccess!.organization.id
    await pool.query(
      `INSERT INTO notification_settings (organization_id, notify_emails)
       VALUES ($1, $2)
       ON CONFLICT (organization_id) DO UPDATE SET notify_emails = EXCLUDED.notify_emails, updated_at = NOW()`,
      [organizationId, input.emails],
    )
    return notificationsResponse(organizationId)
  })

  // Genera un codigo de un solo uso y devuelve el link t.me/<bot>?start=<codigo>.
  app.post('/telegram/link', { preHandler: writeRoles }, async (request, reply) => {
    if (!isTelegramAvailable()) {
      return reply.code(409).send({ message: UNAVAILABLE_MESSAGE, code: 'telegram_unavailable' })
    }
    const organizationId = request.organizationAccess!.organization.id
    await createTelegramLinkCode(organizationId)
    return notificationsResponse(organizationId)
  })

  // La consola lo llama mientras espera que el chat envie el codigo al bot.
  app.post('/telegram/check', { preHandler: writeRoles }, async (request, reply) => {
    if (!isTelegramAvailable()) {
      return reply.code(409).send({ message: UNAVAILABLE_MESSAGE, code: 'telegram_unavailable' })
    }
    try {
      await processTelegramUpdates()
    } catch (error) {
      request.log.warn({ error: error instanceof Error ? error.message : String(error) }, 'No se pudieron leer los mensajes del bot.')
      return reply.code(502).send({ message: 'No se pudo consultar a Telegram. Probá de nuevo en unos segundos.', code: 'telegram_error' })
    }
    return notificationsResponse(request.organizationAccess!.organization.id)
  })

  app.delete('/telegram', { preHandler: writeRoles }, async (request) => {
    const organizationId = request.organizationAccess!.organization.id
    await pool.query(
      `UPDATE notification_settings
       SET telegram_chat_id = NULL, telegram_chat_title = NULL, telegram_linked_at = NULL,
           telegram_link_code = NULL, telegram_link_expires_at = NULL, updated_at = NOW()
       WHERE organization_id = $1`,
      [organizationId],
    )
    return notificationsResponse(organizationId)
  })

  app.post(
    '/test',
    { preHandler: writeRoles, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const organizationId = request.organizationAccess!.organization.id
      const results = await sendTestNotification(organizationId)
      if (results.length === 0) {
        return reply.code(409).send({ message: 'No hay ningún canal de aviso configurado.', code: 'no_channels' })
      }
      return { results }
    },
  )
}
