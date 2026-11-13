import { isDatabaseUnavailableError } from '../../db/errors.js'
import { dispatchDueNotifications } from './notifications.service.js'

const INTERVAL_MS = 5_000

type Logger = {
  info: (obj: object, msg: string) => void
  warn: (obj: object, msg: string) => void
  error: (obj: object, msg: string) => void
}

/**
 * Despachador de avisos dentro del proceso de la API (mision 7.4). Una vuelta cada 5 s, sin
 * solaparse. Con varias instancias no se duplican envios: cada fila se toma con un lease.
 */
export function startNotificationWorker(log: Logger) {
  let timer: NodeJS.Timeout | undefined
  let stopped = false
  let running: Promise<void> | null = null

  const tick = async () => {
    try {
      const result = await dispatchDueNotifications(log)
      if (result.sent || result.retried || result.failed) {
        log.info(result, 'Avisos de pedidos procesados.')
      }
    } catch (error) {
      // Base ocupada o caida: se reintenta en la proxima vuelta, sin tirar el proceso.
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
      if (isDatabaseUnavailableError(error)) log.warn({ code }, 'Despachador de avisos: base no disponible.')
      else log.error({ code, message: error instanceof Error ? error.message : String(error) }, 'Despachador de avisos: error inesperado.')
    }
  }

  const schedule = () => {
    if (stopped) return
    timer = setTimeout(() => {
      running = tick().finally(() => {
        running = null
        schedule()
      })
    }, INTERVAL_MS)
  }

  schedule()

  return async function stop() {
    stopped = true
    clearTimeout(timer)
    await running
  }
}
