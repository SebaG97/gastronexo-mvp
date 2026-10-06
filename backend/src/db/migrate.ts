import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, readinessPool } from './pool.js'
import { withTransaction } from './transaction.js'

const migrationsDirectory = join(fileURLToPath(new URL('.', import.meta.url)), 'migrations')

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort()

  for (const file of files) {
    const result = await pool.query<{ name: string }>(
      'SELECT name FROM schema_migrations WHERE name = $1',
      [file],
    )

    if (result.rowCount) {
      continue
    }

    const sql = await readFile(join(migrationsDirectory, file), 'utf8')
    await withTransaction(async (client) => {
      // Los timeouts de sesion del pool estan pensados para requests de la API, no para DDL.
      await client.query('SET LOCAL statement_timeout = 0')
      await client.query('SET LOCAL lock_timeout = 0')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
    })
    console.info(`Applied migration ${file}`)
  }
}

migrate()
  .then(() => Promise.all([pool.end(), readinessPool.end()]))
  .catch(async (error: unknown) => {
    console.error('Migration failed', error)
    await Promise.all([pool.end(), readinessPool.end()])
    process.exitCode = 1
  })
