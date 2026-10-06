import { Pool } from 'pg'
import { config } from '../config.js'

const ssl = config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined

/**
 * Pool de la API. Si todas las conexiones estan ocupadas, `connect()` espera como mucho
 * DB_POOL_CONNECTION_TIMEOUT_MS y falla (la API responde 503) en lugar de colgarse.
 * Cada sesion lleva timeouts de sentencia, de espera de bloqueo y de transaccion inactiva.
 */
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl,
  max: config.DB_POOL_MAX,
  connectionTimeoutMillis: config.DB_POOL_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: config.DB_POOL_IDLE_TIMEOUT_MS,
  statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
  lock_timeout: config.DB_LOCK_TIMEOUT_MS,
  idle_in_transaction_session_timeout: config.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
})

/**
 * Pool de una sola conexion para /ready. No compite por un slot con las escrituras: aunque el
 * pool de la API este agotado, /ready contesta (200 o 503) dentro de DB_READY_TIMEOUT_MS.
 */
export const readinessPool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl,
  max: 1,
  connectionTimeoutMillis: config.DB_READY_TIMEOUT_MS,
  idleTimeoutMillis: 60000,
  statement_timeout: config.DB_READY_TIMEOUT_MS,
})
