import { buildApp } from './app.js'
import { config } from './config.js'
import { pool, readinessPool } from './db/pool.js'
import { startNotificationWorker } from './modules/notifications/notification-worker.js'

const app = buildApp()
const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']

let shutdownInProgress = false
let shutdownHandlersRegistered = false
let stopNotificationWorker: (() => Promise<void>) | undefined

function extractErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code)
  }

  return undefined
}

for (const databasePool of [pool, readinessPool]) {
  databasePool.on('error', (error) => {
    app.log.warn(
      { code: extractErrorCode(error) },
      'Se detectó una interrupción en una conexión inactiva de PostgreSQL.',
    )
  })
}

async function checkDatabaseReadiness() {
  try {
    await pool.query('SELECT $1::int AS startup_check', [1])
    return true
  } catch (error) {
    app.log.error(
      { code: extractErrorCode(error) },
      'No se pudo iniciar la API porque PostgreSQL no está disponible.',
    )
    return false
  }
}

async function shutdown(signal: NodeJS.Signals | 'startup_failure') {
  if (shutdownInProgress) {
    return
  }

  shutdownInProgress = true
  app.log.info({ signal }, 'Iniciando apagado ordenado de la API.')

  try {
    // Primero el despachador: termina el envio en curso antes de cerrar el pool.
    await stopNotificationWorker?.()
  } catch (error) {
    app.log.error({ code: extractErrorCode(error) }, 'Error al detener el despachador de avisos.')
  }

  try {
    await app.close()
  } catch (error) {
    app.log.error({ code: extractErrorCode(error) }, 'Error al cerrar Fastify.')
  }

  try {
    await Promise.all([pool.end(), readinessPool.end()])
  } catch (error) {
    app.log.error({ code: extractErrorCode(error) }, 'Error al cerrar el pool de PostgreSQL.')
  }
}

function registerShutdownHandlers() {
  if (shutdownHandlersRegistered) {
    return
  }

  shutdownHandlersRegistered = true

  for (const signal of shutdownSignals) {
    process.once(signal, () => {
      void shutdown(signal).finally(() => {
        process.exit(0)
      })
    })
  }
}

async function start() {
  registerShutdownHandlers()

  try {
    const isDatabaseReady = await checkDatabaseReadiness()

    if (!isDatabaseReady) {
      await shutdown('startup_failure')
      process.exit(1)
    }

    await app.listen({ port: config.PORT, host: '0.0.0.0' })

    if (config.NOTIFICATIONS_WORKER_ENABLED) {
      stopNotificationWorker = startNotificationWorker(app.log)
    }
  } catch (error) {
    app.log.error({ code: extractErrorCode(error) }, 'La API no pudo iniciar correctamente.')
    await shutdown('startup_failure')
    process.exit(1)
  }
}

void start()
