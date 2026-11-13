import type { PoolClient } from 'pg'
import { isRetryableTransactionError } from './errors.js'
import { pool } from './pool.js'

/** Lo unico que ve el codigo de negocio de una conexion: no puede liberarla ni pedir otra. */
export type DbClient = Pick<PoolClient, 'query'>

/**
 * Corta una transaccion con ROLLBACK y una respuesta de negocio (404, 409, ...). La lanza
 * `abortTransaction` y la responde el error handler de la app con el mismo status y body.
 */
export class TransactionAbort extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: unknown,
  ) {
    super('transaction_aborted')
  }
}

export function abortTransaction(statusCode: number, body: unknown): never {
  throw new TransactionAbort(statusCode, body)
}

const MAX_ATTEMPTS = 3

function retryDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.floor(Math.random() * 40)))
}

/**
 * Unica forma de abrir una transaccion: una transaccion = una conexion.
 *
 * - `work` recibe el cliente de la transaccion y TODA lectura o escritura (incluida la relectura
 *   del resultado que se devuelve) va por ese cliente. Nunca `pool.query` adentro.
 * - Si `work` termina, COMMIT; si lanza (incluido `abortTransaction`), ROLLBACK y se relanza.
 * - Deadlock o fallo de serializacion: se reintenta la transaccion completa, hasta 3 intentos.
 *   Si persiste, el error llega al handler de la app, que responde 503 generico.
 * - Si el ROLLBACK falla, la conexion se descarta en vez de volver al pool.
 *
 * Orden de bloqueo (ver docs/concurrency-audit-6.3.md): cabecera del documento FOR UPDATE ->
 * inventory_balances (asegurar los faltantes y bloquear ORDER BY product_id, warehouse_id) ->
 * products FOR NO KEY UPDATE ORDER BY id -> secuencias de numeracion.
 */
export async function withTransaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect()
    let brokenConnection: Error | undefined
    let retry = false

    try {
      await client.query('BEGIN')
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        brokenConnection = rollbackError instanceof Error ? rollbackError : new Error('rollback_failed')
      }

      if (attempt >= MAX_ATTEMPTS || !isRetryableTransactionError(error)) {
        throw error
      }
      retry = true
    } finally {
      client.release(brokenConnection)
    }

    // La conexion ya volvio al pool: la espera antes de reintentar no retiene un slot.
    if (retry) {
      await retryDelay(attempt)
    }
  }
}
