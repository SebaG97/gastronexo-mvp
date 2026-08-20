import { buildApp } from './app.js'
import { config } from './config.js'
import { pool } from './db/pool.js'

const app = buildApp()
const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']

let shutdownInProgress = false
let shutdownHandlersRegistered = false

function extractErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code)
  }

  return undefined
}

pool.on('error', (error) => {
  app.log.warn(
    { code: extractErrorCode(error) },
    'Se detectó una interrupción en una conexión inactiva de PostgreSQL.',
  )
})

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
    await app.close()
  } catch (error) {
    app.log.error({ code: extractErrorCode(error) }, 'Error al cerrar Fastify.')
  }

  try {
    await pool.end()
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
  } catch (error) {
    app.log.error({ code: extractErrorCode(error) }, 'La API no pudo iniciar correctamente.')
    await shutdown('startup_failure')
    process.exit(1)
  }
}

void start()
