// Avisos de pedidos nuevos fuera de la consola (mision 7.4).
//
// Flujo: el pedido de la tienda encola una fila por canal configurado en order_notifications,
// dentro de su misma transaccion. El despachador toma las filas vencidas con un lease (UPDATE
// de una sola sentencia, sin transaccion abierta mientras habla con Telegram o el email),
// envia y marca sent / reintenta con espera creciente / failed.
import { randomBytes } from 'node:crypto'
import { config } from '../../config.js'
import { pool } from '../../db/pool.js'
import type { DbClient } from '../../db/transaction.js'
import { getOrderById } from '../orders/orders.service.js'
import {
  ChannelError,
  getTelegramUpdates,
  isEmailAvailable,
  isTelegramAvailable,
  sendEmail,
  sendTelegramMessage,
} from './channels.js'

export type NotificationChannel = 'telegram' | 'email'

const MAX_ATTEMPTS = 6
// Mientras un proceso envia, nadie mas toma la fila durante este tiempo.
const LEASE_SECONDS = 120
const BATCH_SIZE = 10
const LINK_CODE_TTL_MINUTES = 15

/** 30 s, 1 min, 2 min, 4 min, 8 min: unos 15 minutos en total antes de darse por vencido. */
export function retryDelaySeconds(attempt: number) {
  return 30 * 2 ** Math.max(0, attempt - 1)
}

// ---------- Configuracion por organizacion ----------

export type NotificationSettingsRow = {
  notifyEmails: string[]
  telegramChatId: string | null
  telegramChatTitle: string | null
  telegramLinkedAt: string | null
  telegramLinkCode: string | null
  telegramLinkExpiresAt: string | null
}

export async function getNotificationSettings(client: DbClient, organizationId: string): Promise<NotificationSettingsRow> {
  const result = await client.query<NotificationSettingsRow>(
    `SELECT
       notify_emails AS "notifyEmails",
       telegram_chat_id AS "telegramChatId",
       telegram_chat_title AS "telegramChatTitle",
       telegram_linked_at AS "telegramLinkedAt",
       telegram_link_code AS "telegramLinkCode",
       telegram_link_expires_at AS "telegramLinkExpiresAt"
     FROM notification_settings
     WHERE organization_id = $1`,
    [organizationId],
  )
  return (
    result.rows[0] ?? {
      notifyEmails: [],
      telegramChatId: null,
      telegramChatTitle: null,
      telegramLinkedAt: null,
      telegramLinkCode: null,
      telegramLinkExpiresAt: null,
    }
  )
}

/** Canales que el servidor tiene configurados y la organizacion completo. */
function activeChannels(settings: NotificationSettingsRow): NotificationChannel[] {
  const channels: NotificationChannel[] = []
  if (isTelegramAvailable() && settings.telegramChatId) channels.push('telegram')
  if (isEmailAvailable() && settings.notifyEmails.length > 0) channels.push('email')
  return channels
}

/** Se llama dentro de la transaccion que crea el pedido. */
export async function enqueueOrderNotifications(client: DbClient, organizationId: string, orderId: string) {
  const channels = activeChannels(await getNotificationSettings(client, organizationId))
  if (channels.length === 0) return
  await client.query(
    `INSERT INTO order_notifications (organization_id, order_id, channel)
     SELECT $1, $2, channel FROM unnest($3::text[]) AS channel
     ON CONFLICT (order_id, channel) DO NOTHING`,
    [organizationId, orderId, channels],
  )
}

// ---------- Mensaje ----------

const money = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 })
const quantity = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 3 })
const formatMoney = (value: string | number | null) => `Gs. ${money.format(Math.round(Number(value ?? 0)))}`

const unitLabels: Record<string, string> = { kg: 'kg', g: 'g', l: 'l', ml: 'ml', unit: 'u.', box: 'caja', portion: 'porción' }
const paymentLabels: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card_on_delivery: 'Tarjeta contra entrega',
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type OrderForMessage = NonNullable<Awaited<ReturnType<typeof getOrderById>>>

export type OrderMessage = { subject: string; text: string; html: string; telegramHtml: string }

export function buildOrderMessage(storeName: string, order: OrderForMessage): OrderMessage {
  const lines: Array<[label: string, value: string]> = []
  lines.push(['Cliente', `${order.contactName ?? order.customerName}${order.contactPhone ? ` · ${order.contactPhone}` : ''}`])
  if (order.fulfillmentType === 'delivery') {
    const address = [order.deliveryAddress, order.deliveryReference ? `(${order.deliveryReference})` : null].filter(Boolean).join(' ')
    lines.push(['Entrega', `Envío a ${order.deliveryZoneName ?? 'zona sin nombre'}${address ? ` — ${address}` : ''}`])
  } else {
    lines.push(['Entrega', 'Retira en el local'])
  }
  if (order.requestedDeliveryDate) {
    lines.push(['Fecha pedida', String(order.requestedDeliveryDate).slice(0, 10)])
  }
  const payment = paymentLabels[order.paymentMethod ?? ''] ?? '—'
  lines.push(['Pago', order.cashChangeFor ? `${payment} (paga con ${formatMoney(order.cashChangeFor)})` : payment])

  const items = (order.items as Array<Record<string, string | null>>).map((item) => {
    const unit = unitLabels[item.productUnitSnapshot ?? ''] ?? item.productUnitSnapshot ?? ''
    const cut = item.cutNameSnapshot ? ` (${item.cutNameSnapshot})` : ''
    return `${quantity.format(Number(item.quantity))} ${unit} ${item.productNameSnapshot}${cut} — ${formatMoney(item.subtotal)}`
  })

  const totals = [`Productos: ${formatMoney(order.subtotal)}`]
  if (Number(order.deliveryFee) > 0) totals.push(`Envío: ${formatMoney(order.deliveryFee)}`)
  totals.push(`Total: ${formatMoney(order.total)}`)

  const title = `Nuevo pedido ${order.orderNumber} en ${storeName}`
  const consoleLink = config.PUBLIC_APP_URL ? `${config.PUBLIC_APP_URL.replace(/\/$/, '')}/` : null

  const text = [
    title,
    '',
    ...lines.map(([label, value]) => `${label}: ${value}`),
    '',
    ...items.map((item) => `• ${item}`),
    '',
    ...totals,
    ...(order.notes ? ['', `Notas: ${order.notes}`] : []),
    '',
    consoleLink ? `Confirmalo en Gastronexo: ${consoleLink}` : 'Confirmalo desde Pedidos en Gastronexo.',
  ].join('\n')

  const telegramHtml = [
    `🛒 <b>${escapeHtml(title)}</b>`,
    '',
    ...lines.map(([label, value]) => `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`),
    '',
    ...items.map((item) => `• ${escapeHtml(item)}`),
    '',
    ...totals.map((line, index) => (index === totals.length - 1 ? `<b>${escapeHtml(line)}</b>` : escapeHtml(line))),
    ...(order.notes ? ['', `<i>Notas: ${escapeHtml(order.notes)}</i>`] : []),
    '',
    consoleLink ? `<a href="${escapeHtml(consoleLink)}">Abrir Gastronexo</a>` : 'Confirmalo desde Pedidos en Gastronexo.',
  ].join('\n')

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
<table style="border-collapse:collapse;margin-bottom:12px">${lines
    .map(([label, value]) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${escapeHtml(label)}</td><td style="padding:2px 0">${escapeHtml(value)}</td></tr>`)
    .join('')}</table>
<ul style="padding-left:18px;margin:0 0 12px">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
<p style="margin:0 0 12px">${totals.map((line, index) => (index === totals.length - 1 ? `<strong>${escapeHtml(line)}</strong>` : escapeHtml(line))).join('<br>')}</p>
${order.notes ? `<p style="margin:0 0 12px"><em>Notas: ${escapeHtml(order.notes)}</em></p>` : ''}
<p style="margin:0">${consoleLink ? `<a href="${escapeHtml(consoleLink)}">Confirmalo en Gastronexo</a>` : 'Confirmalo desde Pedidos en Gastronexo.'}</p>
</body></html>`

  return { subject: title, text, html, telegramHtml }
}

async function getStoreName(client: DbClient, organizationId: string) {
  const result = await client.query<{ name: string }>(
    `SELECT COALESCE(NULLIF(s.display_name, ''), o.name) AS name
     FROM organizations o
     LEFT JOIN storefront_settings s ON s.organization_id = o.id
     WHERE o.id = $1`,
    [organizationId],
  )
  return result.rows[0]?.name ?? 'tu tienda'
}

async function deliver(channel: NotificationChannel, settings: NotificationSettingsRow, message: OrderMessage) {
  if (channel === 'telegram') {
    if (!settings.telegramChatId) throw new ChannelError('No hay un chat de Telegram vinculado.', true)
    await sendTelegramMessage(settings.telegramChatId, message.telegramHtml)
  } else {
    if (settings.notifyEmails.length === 0) throw new ChannelError('No hay emails configurados.', true)
    await sendEmail(settings.notifyEmails, message.subject, message.text, message.html)
  }
}

// ---------- Despachador ----------

type ClaimedNotification = { id: string; organizationId: string; orderId: string; channel: NotificationChannel; attempts: number }

/** Toma hasta BATCH_SIZE avisos vencidos. Una sentencia: no queda ninguna transaccion abierta. */
async function claimDueNotifications() {
  const result = await pool.query<ClaimedNotification>(
    `UPDATE order_notifications n
     SET attempts = n.attempts + 1,
         next_attempt_at = NOW() + make_interval(secs => $1),
         updated_at = NOW()
     WHERE n.id IN (
       SELECT id FROM order_notifications
       WHERE status = 'pending' AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING n.id, n.organization_id AS "organizationId", n.order_id AS "orderId", n.channel, n.attempts`,
    [LEASE_SECONDS, BATCH_SIZE],
  )
  return result.rows
}

async function markSent(id: string) {
  await pool.query(
    `UPDATE order_notifications
     SET status = 'sent', sent_at = NOW(), last_error = NULL, updated_at = NOW()
     WHERE id = $1`,
    [id],
  )
}

async function markFailure(notification: ClaimedNotification, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : 'error desconocido'
  const permanent = error instanceof ChannelError && error.permanent
  const giveUp = permanent || notification.attempts >= MAX_ATTEMPTS
  await pool.query(
    `UPDATE order_notifications
     SET status = $2,
         last_error = $3,
         next_attempt_at = NOW() + make_interval(secs => $4),
         updated_at = NOW()
     WHERE id = $1`,
    [notification.id, giveUp ? 'failed' : 'pending', message, retryDelaySeconds(notification.attempts)],
  )
  return giveUp
}

export type DispatchResult = { sent: number; retried: number; failed: number }

export async function dispatchDueNotifications(log?: { warn: (obj: object, msg: string) => void }): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, retried: 0, failed: 0 }
  const claimed = await claimDueNotifications()
  for (const notification of claimed) {
    try {
      const order = await getOrderById(pool, notification.organizationId, notification.orderId)
      if (!order) throw new ChannelError('El pedido ya no existe.', true)
      const [settings, storeName] = await Promise.all([
        getNotificationSettings(pool, notification.organizationId),
        getStoreName(pool, notification.organizationId),
      ])
      await deliver(notification.channel, settings, buildOrderMessage(storeName, order))
      await markSent(notification.id)
      result.sent += 1
    } catch (error) {
      const gaveUp = await markFailure(notification, error)
      if (gaveUp) result.failed += 1
      else result.retried += 1
      log?.warn(
        { notificationId: notification.id, channel: notification.channel, attempt: notification.attempts, gaveUp },
        `No se pudo enviar el aviso de pedido: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return result
}

/** Envio de prueba desde la consola: no pasa por la cola. */
export async function sendTestNotification(organizationId: string) {
  const [settings, storeName] = await Promise.all([getNotificationSettings(pool, organizationId), getStoreName(pool, organizationId)])
  const channels = activeChannels(settings)
  const text = `Prueba de avisos de ${storeName}: si ves este mensaje, los pedidos nuevos de la tienda van a llegar acá.`
  const message: OrderMessage = {
    subject: `Prueba de avisos de ${storeName}`,
    text,
    html: `<p style="font-family:Arial,sans-serif">${escapeHtml(text)}</p>`,
    telegramHtml: `✅ ${escapeHtml(text)}`,
  }
  const results: Array<{ channel: NotificationChannel; ok: boolean; error?: string }> = []
  for (const channel of channels) {
    try {
      await deliver(channel, settings, message)
      results.push({ channel, ok: true })
    } catch (error) {
      results.push({ channel, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

// ---------- Vinculacion de Telegram ----------

/** Codigo legible, sin caracteres ambiguos (0/O, 1/I). */
function createLinkCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(8)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

export async function createTelegramLinkCode(organizationId: string) {
  const code = createLinkCode()
  const result = await pool.query<{ expiresAt: string }>(
    `INSERT INTO notification_settings (organization_id, telegram_link_code, telegram_link_expires_at)
     VALUES ($1, $2, NOW() + make_interval(mins => $3))
     ON CONFLICT (organization_id) DO UPDATE SET
       telegram_link_code = EXCLUDED.telegram_link_code,
       telegram_link_expires_at = EXCLUDED.telegram_link_expires_at,
       updated_at = NOW()
     RETURNING telegram_link_expires_at AS "expiresAt"`,
    [organizationId, code, LINK_CODE_TTL_MINUTES],
  )
  return { code, expiresAt: result.rows[0].expiresAt }
}

const START_COMMAND = /^\/start(?:@\w+)?\s+([A-Z0-9]{6,16})\s*$/i

function chatTitle(chat: NonNullable<NonNullable<Awaited<ReturnType<typeof getTelegramUpdates>>[number]['message']>['chat']>) {
  if (chat.title) return chat.title
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ')
  return name || (chat.username ? `@${chat.username}` : `chat ${chat.id}`)
}

let processingUpdates: Promise<number> | null = null

/**
 * Lee los mensajes nuevos del bot y vincula los chats que enviaron "/start <codigo>". Sin
 * webhook: se llama desde la consola mientras se espera la vinculacion. Una sola lectura a la
 * vez por proceso; el offset queda en la base, asi un update no se procesa dos veces.
 */
export function processTelegramUpdates() {
  processingUpdates ??= (async () => {
    try {
      const state = await pool.query<{ offset: string }>('SELECT update_offset::text AS offset FROM telegram_bot_state')
      const offset = Number(state.rows[0]?.offset ?? 0)
      const updates = await getTelegramUpdates(offset)
      let linked = 0
      for (const update of updates) {
        const text = update.message?.text
        const chat = update.message?.chat
        const match = text && chat ? START_COMMAND.exec(text.trim()) : null
        if (!match || !chat) continue
        const linkedRow = await pool.query<{ organizationId: string }>(
          `UPDATE notification_settings
           SET telegram_chat_id = $2,
               telegram_chat_title = $3,
               telegram_linked_at = NOW(),
               telegram_link_code = NULL,
               telegram_link_expires_at = NULL,
               updated_at = NOW()
           WHERE telegram_link_code = $1
             AND telegram_link_expires_at > NOW()
           RETURNING organization_id AS "organizationId"`,
          [match[1].toUpperCase(), String(chat.id), chatTitle(chat).slice(0, 120)],
        )
        const organizationId = linkedRow.rows[0]?.organizationId
        try {
          if (organizationId) {
            linked += 1
            const storeName = await getStoreName(pool, organizationId)
            await sendTelegramMessage(String(chat.id), `✅ Listo: este chat va a recibir los pedidos nuevos de <b>${escapeHtml(storeName)}</b>.`)
          } else {
            await sendTelegramMessage(String(chat.id), 'Ese código no es válido o ya venció. Generá uno nuevo desde Tienda online → Avisos en Gastronexo.')
          }
        } catch {
          // La vinculacion ya quedo hecha aunque la respuesta al chat falle.
        }
      }
      if (updates.length > 0) {
        const nextOffset = Math.max(...updates.map((update) => update.update_id)) + 1
        await pool.query(
          'UPDATE telegram_bot_state SET update_offset = GREATEST(update_offset, $1), updated_at = NOW()',
          [nextOffset],
        )
      }
      return linked
    } finally {
      processingUpdates = null
    }
  })()
  return processingUpdates
}
