import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './pool.js'

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
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      console.info(`Applied migration ${file}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

migrate()
  .then(() => pool.end())
  .catch(async (error: unknown) => {
    console.error('Migration failed', error)
    await pool.end()
    process.exitCode = 1
  })
