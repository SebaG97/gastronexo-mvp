// Clientes HTTP de los canales de aviso (mision 7.4). Sin SDKs: fetch con timeout.
import { config } from '../../config.js'

const REQUEST_TIMEOUT_MS = 10_000

/** Error de envio. `permanent`: reintentar no sirve (credencial invalida, chat bloqueado, etc.). */
export class ChannelError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message)
  }
}

export const isTelegramAvailable = () => Boolean(config.TELEGRAM_BOT_TOKEN)
export const isEmailAvailable = () => Boolean(config.RESEND_API_KEY && config.EMAIL_FROM)

function classifyHttpFailure(status: number, description: string) {
  // 429 y 5xx: transitorio. Resto de 4xx: el mismo pedido va a fallar igual.
  const permanent = status >= 400 && status < 500 && status !== 429
  return new ChannelError(`${status}: ${description}`.slice(0, 500), permanent)
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new ChannelError(`red: ${error instanceof Error ? error.message : String(error)}`, false)
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
  return { response, data }
}

// ---------- Telegram ----------

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string; error_code?: number }

async function telegramCall<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new ChannelError('Telegram no está configurado en el servidor.', true)
  }
  // El token va en la URL: nunca se loguea la URL completa.
  const { response, data } = await postJson(`${config.TELEGRAM_API_BASE}/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, body)
  const payload = data as TelegramResponse<T> | null
  if (!response.ok || !payload?.ok) {
    throw classifyHttpFailure(response.status, payload?.description ?? 'respuesta inválida de Telegram')
  }
  return payload.result as T
}

let cachedBotUsername: string | null = null

export async function getTelegramBotUsername() {
  if (!cachedBotUsername) {
    const me = await telegramCall<{ username: string }>('getMe')
    cachedBotUsername = me.username
  }
  return cachedBotUsername
}

export async function sendTelegramMessage(chatId: string, html: string) {
  await telegramCall('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  })
}

export type TelegramUpdate = {
  update_id: number
  message?: {
    text?: string
    chat: { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string }
  }
}

export async function getTelegramUpdates(offset: number) {
  return telegramCall<TelegramUpdate[]>('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] })
}

// ---------- Email (Resend) ----------

export async function sendEmail(to: string[], subject: string, text: string, html: string) {
  if (!isEmailAvailable()) {
    throw new ChannelError('El email no está configurado en el servidor.', true)
  }
  const { response, data } = await postJson(
    `${config.EMAIL_API_BASE}/emails`,
    { from: config.EMAIL_FROM, to, subject, text, html },
    { Authorization: `Bearer ${config.RESEND_API_KEY}` },
  )
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : 'respuesta inválida del proveedor de email'
    throw classifyHttpFailure(response.status, message)
  }
}
