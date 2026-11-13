import { useEffect, useState, type FormEvent } from 'react'
import { Button, Panel, StatusBadge, TableScroll } from '../../shared/components'
import {
  ApiError,
  checkTelegramLink,
  getNotifications,
  sendNotificationTest,
  startTelegramLink,
  unlinkTelegram,
  updateNotificationEmails,
  type NotificationsResponse,
} from '../../shared/lib/auth-api'

// Mision 7.4: destinos de aviso de pedidos nuevos (Telegram y email).

type NotificationsPanelProps = {
  token: string
  canManage: boolean
}

// Mientras se espera que el chat envie el codigo al bot.
const LINK_POLL_MS = 3_000

const dateTimeFormatter = new Intl.DateTimeFormat('es-PY', { dateStyle: 'short', timeStyle: 'short' })
const timeFormatter = new Intl.DateTimeFormat('es-PY', { timeStyle: 'short' })
const channelLabel = { telegram: 'Telegram', email: 'Email' } as const
const statusLabel = { pending: 'Pendiente', sent: 'Enviado', failed: 'Falló' } as const
const statusTone = { pending: 'warning', sent: 'success', failed: 'danger' } as const

type Message = { tone: 'success' | 'error'; text: string }

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}

export function NotificationsPanel({ token, canManage }: NotificationsPanelProps) {
  const [data, setData] = useState<NotificationsResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [emailsText, setEmailsText] = useState('')
  const [busy, setBusy] = useState<null | 'link' | 'unlink' | 'emails' | 'test'>(null)
  const [message, setMessage] = useState<Message | null>(null)
  function apply(response: NotificationsResponse) {
    setData(response)
  }

  useEffect(() => {
    let cancelled = false
    getNotifications(token)
      .then((response) => {
        if (cancelled) return
        apply(response)
        setEmailsText(response.email.recipients.join(', '))
      })
      .catch(() => !cancelled && setLoadError('No se pudo cargar la configuración de avisos.'))
    return () => {
      cancelled = true
    }
  }, [token])

  // Con un codigo pendiente, se consulta al bot hasta que el chat quede vinculado o venza.
  const pendingLink = data?.telegram.pendingLink ?? null
  useEffect(() => {
    if (!pendingLink || !canManage) return
    let cancelled = false
    const timer = window.setInterval(async () => {
      try {
        const response = await checkTelegramLink(token)
        if (cancelled) return
        const justLinked = response.telegram.linked && !response.telegram.pendingLink
        setData(response)
        if (justLinked) {
          setMessage({ tone: 'success', text: `Telegram vinculado con "${response.telegram.chatTitle}". Te mandamos un mensaje de confirmación.` })
        }
      } catch {
        // Telegram no respondio: se reintenta en la proxima vuelta.
      }
    }, LINK_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pendingLink?.code, canManage, token])

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<NotificationsResponse>, success?: string) {
    setBusy(kind)
    setMessage(null)
    try {
      const response = await action()
      apply(response)
      if (success) setMessage({ tone: 'success', text: success })
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error, 'No se pudo guardar el cambio.') })
    } finally {
      setBusy(null)
    }
  }

  async function handleEmails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const emails = emailsText
      .split(/[\s,;]+/)
      .map((email) => email.trim())
      .filter(Boolean)
    if (emails.length > 5) {
      setMessage({ tone: 'error', text: 'Podés cargar hasta 5 emails.' })
      return
    }
    setBusy('emails')
    setMessage(null)
    try {
      apply(await updateNotificationEmails(emails, token))
      setMessage({ tone: 'success', text: emails.length ? 'Emails de aviso guardados.' : 'Avisos por email desactivados.' })
    } catch (error) {
      // El servidor indica cual email rechazo (issues[].path = "emails.<indice>").
      const issues =
        error instanceof ApiError && typeof error.payload === 'object' && error.payload !== null && 'issues' in error.payload
          ? (error.payload.issues as Array<{ path: string }>)
          : []
      const invalid = issues
        .map((issue) => /^emails\.(\d+)$/.exec(issue.path)?.[1])
        .filter((index): index is string => index !== undefined)
        .map((index) => emails[Number(index)])
      setMessage({
        tone: 'error',
        text: invalid.length
          ? `Revisá ${invalid.length === 1 ? 'este email' : 'estos emails'}: ${invalid.join(', ')} (sin tildes ni ñ antes de la @).`
          : errorText(error, 'No se pudieron guardar los emails.'),
      })
    } finally {
      setBusy(null)
    }
  }

  async function handleTest() {
    setBusy('test')
    setMessage(null)
    try {
      const { results } = await sendNotificationTest(token)
      const failed = results.filter((result) => !result.ok)
      setMessage(
        failed.length === 0
          ? { tone: 'success', text: `Mensaje de prueba enviado por ${results.map((result) => channelLabel[result.channel]).join(' y ')}.` }
          : { tone: 'error', text: failed.map((result) => `${channelLabel[result.channel]}: ${result.error}`).join(' · ') },
      )
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error, 'No se pudo enviar la prueba.') })
    } finally {
      setBusy(null)
    }
  }

  if (loadError) {
    return (
      <Panel title="Avisos de pedidos nuevos">
        <p className="members-message members-message--error" role="alert">{loadError}</p>
      </Panel>
    )
  }
  if (!data) {
    return (
      <Panel title="Avisos de pedidos nuevos">
        <p>Cargando avisos...</p>
      </Panel>
    )
  }

  const { telegram, email } = data
  const anyActive = (telegram.available && telegram.linked) || (email.available && email.recipients.length > 0)

  return (
    <Panel
      title="Avisos de pedidos nuevos"
      action={<StatusBadge tone={anyActive ? 'success' : 'warning'}>{anyActive ? 'Activos' : 'Sin configurar'}</StatusBadge>}
    >
      <p className="purchase-detail-notes">
        Cada pedido que entra por la tienda se avisa por estos canales aunque nadie tenga la consola abierta.
      </p>

      <div className="notify-grid">
        <section className="notify-channel" aria-labelledby="notify-telegram-title">
          <h3 id="notify-telegram-title">Telegram</h3>
          {!telegram.available ? (
            <p className="notify-channel__muted">{telegram.unavailableReason}</p>
          ) : telegram.linked ? (
            <>
              <p>
                Vinculado con <strong>{telegram.chatTitle}</strong>
                {telegram.linkedAt ? ` (desde el ${dateTimeFormatter.format(new Date(telegram.linkedAt))})` : ''}
              </p>
              {canManage ? (
                <div className="notify-channel__actions">
                  <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void run('link', () => startTelegramLink(token))}>
                    Cambiar chat
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => void run('unlink', () => unlinkTelegram(token), 'Telegram desvinculado.')}
                  >
                    Desvincular
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p>Recibí cada pedido en tu Telegram o en un grupo del local.</p>
              {canManage && !telegram.pendingLink ? (
                <Button type="button" disabled={busy !== null} onClick={() => void run('link', () => startTelegramLink(token))}>
                  {busy === 'link' ? 'Generando...' : 'Conectar Telegram'}
                </Button>
              ) : null}
            </>
          )}

          {telegram.available && telegram.pendingLink && canManage ? (
            <div className="notify-link" role="status" aria-live="polite">
              <p>
                <strong>1.</strong>{' '}
                <a href={telegram.pendingLink.url} target="_blank" rel="noreferrer">
                  Abrí @{telegram.botUsername} en Telegram
                </a>{' '}
                y tocá <em>Iniciar</em>.
              </p>
              <p>
                <strong>Para un grupo:</strong> agregá @{telegram.botUsername} al grupo y escribí ahí{' '}
                <code>/start {telegram.pendingLink.code}</code>
              </p>
              <p className="notify-channel__muted">
                Esperando la confirmación… El código vence a las {timeFormatter.format(new Date(telegram.pendingLink.expiresAt))}
              </p>
            </div>
          ) : null}
        </section>

        <section className="notify-channel" aria-labelledby="notify-email-title">
          <h3 id="notify-email-title">Email</h3>
          {!email.available ? (
            <p className="notify-channel__muted">{email.unavailableReason}</p>
          ) : (
            <form onSubmit={handleEmails} className="notify-email-form">
              <label className="field">
                Enviar a (hasta 5, separados por coma)
                <input
                  value={emailsText}
                  disabled={!canManage || busy !== null}
                  placeholder="pedidos@tunegocio.com"
                  onChange={(event) => setEmailsText(event.target.value)}
                />
              </label>
              {canManage ? (
                <Button type="submit" variant="secondary" disabled={busy !== null}>
                  {busy === 'emails' ? 'Guardando...' : 'Guardar emails'}
                </Button>
              ) : null}
            </form>
          )}
        </section>
      </div>

      {message ? (
        <p className={`members-message members-message--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}

      {canManage && anyActive ? (
        <div className="products-form__actions">
          <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void handleTest()}>
            {busy === 'test' ? 'Enviando...' : 'Enviar mensaje de prueba'}
          </Button>
        </div>
      ) : null}

      {data.recent.length > 0 ? (
        <>
          <h3 className="notify-recent-title">Últimos avisos</h3>
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Canal</th>
                  <th>Estado</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((delivery) => (
                  <tr key={`${delivery.orderNumber}-${delivery.channel}`}>
                    <td>{delivery.orderNumber}</td>
                    <td>{channelLabel[delivery.channel]}</td>
                    <td>
                      <StatusBadge tone={statusTone[delivery.status]}>{statusLabel[delivery.status]}</StatusBadge>
                    </td>
                    <td>
                      {delivery.status === 'sent' && delivery.sentAt
                        ? dateTimeFormatter.format(new Date(delivery.sentAt))
                        : delivery.lastError
                          ? `${delivery.attempts} intento${delivery.attempts === 1 ? '' : 's'}: ${delivery.lastError}`
                          : 'En cola'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      ) : null}
    </Panel>
  )
}
