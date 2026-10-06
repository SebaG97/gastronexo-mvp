// Clasificacion de errores de PostgreSQL / node-postgres que no son de negocio.

const RETRYABLE_TRANSACTION_CODES = new Set([
  '40P01', // deadlock_detected
  '40001', // serialization_failure
])

const UNAVAILABLE_CODES = new Set([
  ...RETRYABLE_TRANSACTION_CODES, // si persisten despues de los reintentos
  '55P03', // lock_not_available (lock_timeout)
  '57014', // query_canceled (statement_timeout)
  '25P03', // idle_in_transaction_session_timeout
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
])

const NETWORK_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENOTFOUND'])

// node-postgres no asigna codigo a estos errores, solo mensaje.
const UNAVAILABLE_MESSAGES = [
  'timeout exceeded when trying to connect', // pool agotado: connectionTimeoutMillis
  'Connection terminated',
  'Client has encountered a connection error',
]

export function getDatabaseErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }

  return undefined
}

/** Deadlock o fallo de serializacion: la transaccion completa se puede reintentar. */
export function isRetryableTransactionError(error: unknown) {
  const code = getDatabaseErrorCode(error)
  return code !== undefined && RETRYABLE_TRANSACTION_CODES.has(code)
}

/**
 * Errores de infraestructura (pool agotado, timeouts, contencion que no se resolvio, base caida).
 * Se responden con 503 generico, sin detalles internos.
 */
export function isDatabaseUnavailableError(error: unknown) {
  const code = getDatabaseErrorCode(error)
  if (code !== undefined && (UNAVAILABLE_CODES.has(code) || NETWORK_ERROR_CODES.has(code) || code.startsWith('08'))) {
    return true
  }

  const message = error instanceof Error ? error.message : ''
  return UNAVAILABLE_MESSAGES.some((fragment) => message.includes(fragment))
}
