import { Pool } from 'pg'
import { config } from '../config.js'

/**
 * Conexion a PostgreSQL (mision 7.5). node-postgres toma los parametros ssl* de la URL por
 * encima de la opcion `ssl` y trata `sslmode=require` como `verify-full`: con la URL de una
 * base administrada (DigitalOcean agrega ?sslmode=require) la conexion falla porque su CA no es
 * publica. Por eso los ssl* se quitan de la URL y el SSL se arma aca:
 * - con DATABASE_CA_CERT (en App Platform: ${db.CA_CERT}) se verifica certificado y host;
 * - sin CA pero con sslmode en la URL o en produccion, SSL sin verificar el certificado;
 * - con sslmode=disable explicito, o en local sin sslmode, sin SSL.
 */
export function buildConnectionOptions(databaseUrl: string, caCert: string | undefined, nodeEnv: string) {
  const url = new URL(databaseUrl)
  const sslmode = url.searchParams.get('sslmode')
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('ssl') || key === 'uselibpqcompat') url.searchParams.delete(key)
  }
  // Un sslmode explicito manda (disable = sin SSL, por ejemplo en una red privada); sin sslmode,
  // produccion usa SSL.
  const wantsSsl = sslmode !== null ? sslmode !== 'disable' : Boolean(caCert) || nodeEnv === 'production'
  const ssl = !wantsSsl
    ? undefined
    : caCert
      ? { ca: caCert.replace(/\\n/g, '\n'), rejectUnauthorized: true }
      : { rejectUnauthorized: false }
  return { connectionString: url.toString(), ssl }
}

const { connectionString, ssl } = buildConnectionOptions(config.DATABASE_URL, config.DATABASE_CA_CERT, config.NODE_ENV)

/**
 * Pool de la API. Si todas las conexiones estan ocupadas, `connect()` espera como mucho
 * DB_POOL_CONNECTION_TIMEOUT_MS y falla (la API responde 503) en lugar de colgarse.
 * Cada sesion lleva timeouts de sentencia, de espera de bloqueo y de transaccion inactiva.
 */
export const pool = new Pool({
  connectionString,
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
  connectionString,
  ssl,
  max: 1,
  connectionTimeoutMillis: config.DB_READY_TIMEOUT_MS,
  idleTimeoutMillis: 60000,
  statement_timeout: config.DB_READY_TIMEOUT_MS,
})
